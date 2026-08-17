/*
 * Anbu Vault Infiltration — KV storage + server-authoritative settlement.
 *
 * The security core of the raid (docs/anbu-infiltration-plan.md §9). Every payout
 * is server-authoritative and follows the repo's hardened patterns:
 *   - the settle takes the SERVER run record (infil:<runId>) and re-checks
 *     completion — never a client "I won";
 *   - the reward roll is a server-supplied random, and BOTH skims are recomputed
 *     inside each pool's failClosed lock from the FRESH balance (the client sends
 *     no amounts, ever);
 *   - the whole drain is wrapped in a deterministic economy journal; its sealed
 *     debit phase lets a failed save credit resume without draining twice;
 *   - combat costs, caches, ryo, and an idempotency receipt are committed in one
 *     player-save write under the fail-closed save lock;
 *   - mergePreservingImages + bumpSaveVersion preserve the autosave contract.
 *
 * Daily-loss ledgers live in their OWN keys (infil-loss:*) — deliberately NOT as
 * new fields on world:territory:* / the village-war record, because
 * normalizeVillageWarRecord rebuilds records from a whitelist and would silently
 * drop an unknown field on the next write. Separate keys = no schema change to
 * shared records and no clobber risk.
 *
 * The supply skim materializes the sector's LAZY accrual first (stored warSupply
 * is usually 0 between collects — accrual derives from lastSupplyAt): inside the
 * territory lock it computes the true collectible via collectTerritorySupply,
 * skims 1% of THAT, and writes back the remainder with the advanced lastSupplyAt —
 * so the owner's later collect sees exactly (total − skim) + new accrual.
 *
 * kv / lock / now are INJECTABLE (default to the real ones) so the currency logic
 * is unit-testable with a fake in-memory store.
 */
import { isDeepStrictEqual } from 'node:util';
import { kv as realKv, type KvLike } from './_storage.js';
import { withKvLock as realWithKvLock, type LockOptions } from './_lock.js';
import { mergePreservingImages, safeName, setSafeRecordValue } from './_utils.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { collectTerritorySupply } from './_territory-supply.js';
import { normalizeVillageWarRecord, villageWarKey } from './_war-state.js';
import {
    reserveEconomyTx,
    markEconomyTx,
    completeEconomyTx,
    failEconomyTx,
} from './_economy-tx.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from './_settlement-receipts.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { awardClanPoints, MAX_CLAN_POINTS_AWARD, CLAN_POINTS_WEEKLY_CAP, clanPointWeekKey } from './_clan-points.js';
import { meritNum } from './village/_village-merit.js';
import {
    rollRewardPools,
    applySkim,
    cachesForSkim,
    cacheItemIdForPool,
    turnInCaches,
    utcDateKey,
    RAID_RYO_REWARD,
    CACHE_STACK_CAP,
    CLAN_CACHES_PER_POINT,
    VILLAGE_TURNIN_MAX_POINTS,
    type WarPool,
    type DailyLossLedger,
} from './_anbu-infiltration.js';
import { augmentSaveWithForgedDefs } from './_forged-item-registry.js';
import { hydrateCharacterFromSave } from './pvp/session.js';
import { applySoloPveUsageCosts } from './solo-pve/_settlement.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import { applyAiFightOutcomeToCharacter, resolveAiFightOutcome } from './missions/_ai-fight-outcome.js';

// ─── injectable deps ─────────────────────────────────────────────────────────
export type InfilKv = Pick<KvLike, 'get' | 'set' | 'del' | 'compareSet'>;
export type InfilLock = <T>(target: string, fn: () => Promise<T>, options?: LockOptions) => Promise<T>;
export type StoreDeps = { kv?: InfilKv; lock?: InfilLock; now?: () => number };
function resolve(deps: StoreDeps) {
    return {
        kv: deps.kv ?? realKv,
        lock: deps.lock ?? realWithKvLock,
        now: deps.now ?? (() => Date.now()),
    };
}

// ─── key scheme ──────────────────────────────────────────────────────────────
export const infilRunKey = (runId: string) => `infil:${runId}`;
export const infilStartCountKey = (slug: string, dateKey: string) => `infil-start-count:${slug}:${dateKey}`;
export const infilActiveRunKey = (slug: string, sector: number) => `infil-active:${slug}:${sector}`;
export const supplyLedgerKey = (sector: number) => `infil-loss:supply:${sector}`;
export const wrLedgerKey = (villageSlug: string) => `infil-loss:wr:${villageSlug}`;
export const anbuSealKey = (villageSlug: string, anbuSlug: string, dateKey: string) => `infil-anbu-seal:${villageSlug}:${anbuSlug}:${dateKey}`;
export const anbuLastDefKey = (villageSlug: string) => `infil-anbu-last:${villageSlug}`;
const TERRITORY_KEY_PREFIX = 'world:territory:';
const AUDIT_LOG_PREFIX = 'audit:anbu-infiltration:';

export const INFIL_RUN_TTL = 60 * 60;              // context outlives the 45-minute combat TTL
export const INFIL_TERMINAL_TTL = 7 * 24 * 60 * 60;
export const INFIL_LEDGER_TTL = 3 * 24 * 60 * 60;  // rollover re-anchors anyway
export const ANBU_SEAL_TTL = 25 * 60 * 60;         // "re-sealed daily" (lazy)
export const ANBU_LAST_DEF_TTL = 30 * 24 * 60 * 60;
export const START_COUNT_TTL = 25 * 60 * 60;

/** KEEP IN SYNC with api/_war-role.ts villageStateKey (module-local there). */
export function villageStateKey(village: string): string {
    return `game:village-state:${villageSlug(village)}`;
}
export function villageSlug(village: string): string {
    return String(village ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

// ─── run record ──────────────────────────────────────────────────────────────
/** The authoritative live run binding plus sealed raid context
 *  (target sector/village, which Anbu defends, who raids). All reward parameters
 *  derive from THIS record at settle — never from the client. */
export interface InfilRun {
    runId: string;
    raiderSlug: string;
    sector: number;
    /** the sector's owning village at start (the WR pool the raid drains) */
    targetVillage: string;
    /** which appointed Anbu is defending this run */
    anbuSlug: string;
    anbuName: string;
    /** sector terrain at start (biome / home-terrain edge, sealed) */
    terrain: string;
    createdAt: number;
    startState?: 'prepared' | 'ready';
    settlement?: {
        settledAt: number;
        response: Record<string, unknown>;
    };
}

export async function readInfilRun(runId: string, deps: StoreDeps = {}): Promise<InfilRun | null> {
    const { kv } = resolve(deps);
    return await kv.get<InfilRun>(infilRunKey(runId));
}

export async function writeInfilRun(run: InfilRun, deps: StoreDeps = {}): Promise<void> {
    const { kv } = resolve(deps);
    await kv.set(infilRunKey(run.runId), run, { ex: run.settlement ? INFIL_TERMINAL_TTL : INFIL_RUN_TTL });
}

export async function deleteInfilRun(runId: string, deps: StoreDeps = {}): Promise<void> {
    const { kv } = resolve(deps);
    await kv.del(infilRunKey(runId));
}

type InfilStartCounter = { count: number; receipts: Record<string, number> };

/** Reserve one daily attempt for a prepared run. The run receipt and counter are
 * one KV value under one lock, so retrying a lost start response cannot consume
 * another attempt. Legacy numeric counters are upgraded in place. */
export async function reserveInfilStartAttempt(
    slug: string,
    runId: string,
    limit: number,
    deps: StoreDeps = {},
): Promise<{ allowed: boolean; replayed: boolean; count: number }> {
    const { kv, lock, now } = resolve(deps);
    const key = infilStartCountKey(slug, utcDateKey(now()));
    return lock(key, async () => {
        const raw = await kv.get<InfilStartCounter | number>(key);
        const current: InfilStartCounter = typeof raw === 'number'
            ? { count: Math.max(0, Math.floor(raw)), receipts: {} }
            : {
                count: Math.max(0, Math.floor(num(raw?.count))),
                receipts: raw?.receipts && typeof raw.receipts === 'object' ? { ...raw.receipts } : {},
            };
        if (Object.prototype.hasOwnProperty.call(current.receipts, runId)) {
            return { allowed: true, replayed: true, count: current.count };
        }
        if (current.count >= Math.max(0, Math.floor(limit))) {
            return { allowed: false, replayed: false, count: current.count };
        }
        const next = {
            count: current.count + 1,
            receipts: { ...current.receipts, [runId]: now() },
        };
        await kv.set(key, next, { ex: START_COUNT_TTL });
        return { allowed: true, replayed: false, count: next.count };
    }, { failClosed: true });
}

// ─── Anbu roster / defender selection / daily seal ───────────────────────────
/** The village's appointed Anbu as safeName slugs (deduped, order-preserving). */
export async function loadAnbuAppointees(village: string, deps: StoreDeps = {}): Promise<string[]> {
    const { kv } = resolve(deps);
    const vs = await kv.get<{ anbuAppointees?: unknown[] }>(villageStateKey(village));
    const raw = Array.isArray(vs?.anbuAppointees) ? vs!.anbuAppointees! : [];
    const out: string[] = [];
    for (const a of raw) {
        const slug = safeName(String(a ?? ''));
        if (slug && !out.includes(slug)) out.push(slug);
    }
    return out;
}

/** Least-recently-defended rotation over the appointee list (missing timestamp =
 *  never defended = picked first; ties break by slug order for determinism).
 *  Stamps the pick's timestamp so the roster rotates. */
export async function pickAnbuDefender(village: string, appointees: string[], deps: StoreDeps = {}): Promise<string | null> {
    if (appointees.length === 0) return null;
    const { kv, now } = resolve(deps);
    const key = anbuLastDefKey(villageSlug(village));
    const lastMap = (await kv.get<Record<string, number>>(key)) ?? {};
    let pick = appointees[0]!;
    let best = Infinity;
    for (const slug of [...appointees].sort()) {
        const t = num(lastMap[slug], 0);
        if (t < best) { best = t; pick = slug; }
    }
    const nextLastMap = { ...lastMap };
    setSafeRecordValue(nextLastMap, pick, now());
    await kv.set(key, nextLastMap, { ex: ANBU_LAST_DEF_TTL });
    return pick;
}

export interface AnbuSnapshot {
    slug: string;
    name: string;
    /** sealed combat-safe character from the canonical PvP hydrator */
    character: Record<string, unknown>;
    sealedAt: number;
}

/** Get today's sealed snapshot of an Anbu, sealing it from their authoritative
 *  save on first use each UTC day ("frozen at appointment + re-sealed daily",
 *  realized lazily — no cron needed). Null if the Anbu has no save. */
export async function getOrSealAnbuSnapshot(village: string, anbuSlug: string, deps: StoreDeps = {}): Promise<AnbuSnapshot | null> {
    const { kv, now } = resolve(deps);
    const t = now();
    const key = anbuSealKey(villageSlug(village), anbuSlug, utcDateKey(t));
    const cached = await kv.get<AnbuSnapshot>(key);
    if (cached && cached.character) return cached;
    const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${anbuSlug}`));
    const char = save?.character as Record<string, unknown> | undefined;
    if (!char || typeof char !== 'object') return null;
    const snapshot: AnbuSnapshot = {
        slug: anbuSlug,
        name: String(char.name ?? anbuSlug),
        character: hydrateCharacterFromSave(char, {}, save ?? null, await loadAdminCombatContent()),
        sealedAt: t,
    };
    await kv.set(key, snapshot, { ex: ANBU_SEAL_TTL });
    return snapshot;
}

// ─── settlement (the currency heart) ─────────────────────────────────────────
export type SettleOutcome =
    | {
        ok: true;
        alreadySettled: boolean;
        rolled: { supply: boolean; wr: boolean };
        supplySkim: number;
        wrSkim: number;
        supplyCaches: number;
        wrCaches: number;
        ryo: number;
        /** caches that could not fit under the 9999 stack cap (enemy still lost them) */
        overflowLost: number;
        saveVersion: number;
        character: Record<string, unknown>;
    }
    | { ok: false; error: 'no-save' | 'credit-failed' };

/**
 * Settle a WON run: roll pools, drain each selected pool under its own failClosed
 * lock (fresh-balance recompute + the 50%/day ledger), then mint caches + ryo into
 * the raider's save. A deterministic economy journal remembers the debit phase,
 * while an in-save receipt makes combat costs + reward credit atomic and
 * replayable. A save-write failure can therefore retry without draining either
 * shared pool twice. `roll` is server randomness and is sealed into the journal.
 */
export async function settleInfiltrationWin(
    run: InfilRun,
    roll: number,
    deps: StoreDeps = {},
    session?: SoloPveSession,
): Promise<SettleOutcome> {
    const { kv, lock, now } = resolve(deps);
    const t = now();

    const requestedRoll = rollRewardPools(roll);
    const vSlug = villageSlug(run.targetVillage);
    const txId = `anbu-infiltration:${run.runId}`;
    const reserved = await reserveEconomyTx({
        id: txId,
        kind: 'anbu-infiltration-raid',
        debitKey: `${TERRITORY_KEY_PREFIX}${run.sector}|${villageWarKey(run.targetVillage)}`,
        creditKey: `save:${run.raiderSlug}`,
        resource: 'war-caches',
        amount: 0,
        meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled: requestedRoll },
    }, { kv: kv as never });
    const sealedRolled = reserved.meta?.rolled as { supply?: unknown; wr?: unknown } | undefined;
    const rolled = {
        supply: sealedRolled?.supply === true,
        wr: sealedRolled?.wr === true,
    };
    const fingerprint = `${run.raiderSlug}:${run.sector}:${run.targetVillage}:${run.anbuSlug}`;
    const receiptId = `anbu-infiltration-${run.runId}`.slice(0, 80);

    const meta = reserved.meta ?? {};
    let supplySkim = Math.max(0, Math.floor(num(meta.supplySkim)));
    let wrSkim = Math.max(0, Math.floor(num(meta.wrSkim)));
    const debitApplied = reserved.state === 'debit-applied'
        || reserved.state === 'credit-applied'
        || reserved.state === 'complete'
        || meta.debitApplied === true;
    if (reserved.state === 'needs-reconcile' && meta.debitApplied !== true) {
        return { ok: false, error: 'credit-failed' };
    }

    try {
        // ── Phase 1a (debit): the sector's warSupply, under the territory lock.
        // Materialize the lazy accrual (collectTerritorySupply mirrors the collect
        // endpoint), skim 1% of the true collectible, write back the remainder.
        if (!debitApplied && rolled.supply) {
            const key = `${TERRITORY_KEY_PREFIX}${run.sector}`;
            supplySkim = await lock(key, async () => {
                const fresh = await kv.get<Record<string, unknown>>(key);
                // Ownership flipped mid-run (sector-war capture) → the pool is no
                // longer the enemy's; nothing to skim.
                if (!fresh || String(fresh.ownerVillage ?? '') !== run.targetVillage) return 0;
                const { collected, nextLastSupplyAt } = collectTerritorySupply(fresh, t);
                const ledger = await kv.get<DailyLossLedger>(supplyLedgerKey(run.sector));
                const { skim, ledger: nextLedger } = applySkim(ledger, collected, t);
                if (skim <= 0) return 0;
                const candidate = { ...fresh, warSupply: collected - skim, lastSupplyAt: nextLastSupplyAt, updatedAt: t };
                try {
                    if (!(await kv.compareSet(key, fresh, candidate))) {
                        throw new Error('anbu-territory-publication-conflict');
                    }
                } catch (error) {
                    const recovered = await kv.get<unknown>(key).catch(() => null);
                    if (!isDeepStrictEqual(recovered, candidate)) throw error;
                }
                await kv.set(supplyLedgerKey(run.sector), nextLedger, { ex: INFIL_LEDGER_TTL });
                return skim;
            }, { failClosed: true });
        }

        // ── Phase 1b (debit): the village's WR pool, under the village-war lock.
        if (!debitApplied && rolled.wr) {
            const warKey = villageWarKey(run.targetVillage);
            wrSkim = await lock(warKey, async () => {
                const rec = normalizeVillageWarRecord(run.targetVillage, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
                const ledger = await kv.get<DailyLossLedger>(wrLedgerKey(vSlug));
                const { skim, ledger: nextLedger } = applySkim(ledger, rec.warResources, t);
                if (skim <= 0) return 0;
                await kv.set(warKey, { ...rec, warResources: rec.warResources - skim });
                await kv.set(wrLedgerKey(vSlug), nextLedger, { ex: INFIL_LEDGER_TTL });
                return skim;
            }, { failClosed: true });
        }

        if (!debitApplied) {
            await markEconomyTx(txId, 'debit-applied', {
                amount: supplySkim + wrSkim,
                meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, debitApplied: true },
            }, { kv: kv as never });
        }

        const supplyCaches = cachesForSkim(supplySkim);
        const wrCaches = cachesForSkim(wrSkim);

        // ── Phase 2 (credit): mint caches + ryo together with usage/outcome and
        // the replay receipt in one save write.
        let overflowLost = 0;
        let saveVersion = 0;
        let character: Record<string, unknown> = {};
        let alreadySettled = false;
        try {
            const out = await lock(`save:${run.raiderSlug}`, async () => {
                const saveKey = `save:${run.raiderSlug}`;
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = rec?.character as Record<string, unknown> | undefined;
                if (!rec || !char) return { error: 'no-save' as const };
                const inspected = inspectSettlementReceipt(char, receiptId, fingerprint);
                if (inspected.status === 'conflict' || inspected.status === 'invalid') {
                    return { error: 'receipt-conflict' as const };
                }
                if (inspected.status === 'replay') {
                    const value = inspected.receipt.value;
                    return {
                        replayed: true as const,
                        lost: Math.max(0, Math.floor(num(value.overflowLost))),
                        saveVersion: num(rec._saveVersion),
                        character: char,
                    };
                }
                const settled = session
                    ? applyAiFightOutcomeToCharacter(
                        applySoloPveUsageCosts(char, session),
                        resolveAiFightOutcome(session),
                        session.player,
                        t,
                    )
                    : char;
                const stacks: Array<{ itemId: string; count: number }> = Array.isArray(settled.itemStacks)
                    ? (settled.itemStacks as Array<{ itemId: string; count: number }>).map(s => ({ ...s }))
                    : [];
                let lost = 0;
                const mint = (pool: WarPool, add: number) => {
                    if (add <= 0) return;
                    const itemId = cacheItemIdForPool(pool);
                    const existing = stacks.find(s => s.itemId === itemId);
                    const have = existing ? Math.max(0, Math.floor(num(existing.count))) : 0;
                    const next = Math.min(CACHE_STACK_CAP, have + add);
                    lost += (have + add) - next;
                    if (existing) existing.count = next;
                    else stacks.push({ itemId, count: next });
                };
                mint('warSupply', supplyCaches);
                mint('warResources', wrCaches);
                const credited = {
                    ...settled,
                    itemStacks: stacks,
                    ryo: num(settled.ryo) + RAID_RYO_REWARD,
                };
                const nextChar = appendSettlementReceipt(credited, inspected.receipts, {
                    requestId: receiptId,
                    fingerprint,
                    value: {
                        kind: 'anbu-infiltration-win',
                        supplySkim,
                        wrSkim,
                        supplyCaches,
                        wrCaches,
                        ryo: RAID_RYO_REWARD,
                        overflowLost: lost,
                    },
                    settledAt: t,
                });
                const next = bumpSaveVersion({ ...rec, character: nextChar });
                await kv.set(saveKey, mergePreservingImages(next as Record<string, unknown>, rec));
                return { replayed: false as const, lost, saveVersion: num((next as Record<string, unknown>)._saveVersion), character: nextChar };
            }, { failClosed: true });
            if ('error' in out) {
                await markEconomyTx(txId, 'debit-applied', {
                    amount: supplySkim + wrSkim,
                    error: out.error,
                    meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, debitApplied: true },
                }, { kv: kv as never });
                return { ok: false, error: out.error === 'no-save' ? 'no-save' : 'credit-failed' };
            }
            alreadySettled = out.replayed;
            overflowLost = out.lost;
            saveVersion = out.saveVersion;
            character = out.character;
        } catch (creditErr) {
            console.error(`[anbu-infiltration] credit interrupted after debit; retry remains safe for ${run.raiderSlug}:`, creditErr);
            await kv.set(`${AUDIT_LOG_PREFIX}LOSS:${run.raiderSlug}:${t}`, {
                ts: t, runId: run.runId, raider: run.raiderSlug, sector: run.sector,
                targetVillage: run.targetVillage, supplySkim, wrSkim,
                error: creditErr instanceof Error ? creditErr.message : String(creditErr),
            }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
            await markEconomyTx(txId, 'debit-applied', {
                amount: supplySkim + wrSkim,
                error: creditErr instanceof Error ? creditErr.message : String(creditErr),
                meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, debitApplied: true },
            }, { kv: kv as never }).catch(() => undefined);
            return { ok: false, error: 'credit-failed' };
        }

        await completeEconomyTx(txId, {
            amount: supplySkim + wrSkim,
            meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, supplyCaches, wrCaches, overflowLost },
        }, { kv: kv as never });
        await kv.set(`${AUDIT_LOG_PREFIX}${run.raiderSlug}:${t}`, {
            ts: t, runId: run.runId, raider: run.raiderSlug, sector: run.sector,
            targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, ryo: RAID_RYO_REWARD,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return {
            ok: true, alreadySettled, rolled,
            supplySkim, wrSkim, supplyCaches, wrCaches,
            ryo: RAID_RYO_REWARD, overflowLost, saveVersion, character,
        };
    } catch (err) {
        // A process that observes a debit-phase failure promotes the durable
        // journal for operator reconciliation. It never guesses whether a failed
        // shared-record write landed.
        await failEconomyTx(txId, err, {}, { kv: kv as never }).catch(() => undefined);
        throw err;
    }
}

export type SettleLossOutcome =
    | { ok: true; alreadySettled: boolean; saveVersion: number; character: Record<string, unknown> }
    | { ok: false; error: 'no-save' | 'receipt-conflict' };

/** Persist terminal HP/hospital state and proven item usage for a failed raid. */
export async function settleInfiltrationLoss(
    run: InfilRun,
    session: SoloPveSession,
    deps: StoreDeps = {},
): Promise<SettleLossOutcome> {
    const { kv, lock, now } = resolve(deps);
    return lock(`save:${run.raiderSlug}`, async () => {
        const saveKey = `save:${run.raiderSlug}`;
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const character = record?.character as Record<string, unknown> | undefined;
        if (!record || !character) return { ok: false as const, error: 'no-save' as const };
        const receiptId = `anbu-infiltration-${run.runId}`.slice(0, 80);
        const fingerprint = `${run.raiderSlug}:${run.sector}:${run.targetVillage}:${run.anbuSlug}`;
        const inspected = inspectSettlementReceipt(character, receiptId, fingerprint);
        if (inspected.status === 'conflict' || inspected.status === 'invalid') {
            return { ok: false as const, error: 'receipt-conflict' as const };
        }
        if (inspected.status === 'replay') {
            return {
                ok: true as const,
                alreadySettled: true as const,
                saveVersion: num(record._saveVersion),
                character,
            };
        }
        const settledCharacter = applyAiFightOutcomeToCharacter(
            applySoloPveUsageCosts(character, session),
            resolveAiFightOutcome(session),
            session.player,
            now(),
        );
        const nextCharacter = appendSettlementReceipt(settledCharacter, inspected.receipts, {
            requestId: receiptId,
            fingerprint,
            value: { kind: 'anbu-infiltration-loss', outcome: session.outcome ?? 'loss' },
            settledAt: now(),
        });
        const next = bumpSaveVersion({ ...record, character: nextCharacter });
        await kv.set(saveKey, mergePreservingImages(next as Record<string, unknown>, record));
        return {
            ok: true as const,
            alreadySettled: false as const,
            saveVersion: num((next as Record<string, unknown>)._saveVersion),
            character: nextCharacter,
        };
    }, { failClosed: true });
}

// ─── turn-in (caches → standing points, type-locked) ─────────────────────────
export type TurnInOutcome =
    | { ok: false; error: 'no-save' | 'not-in-clan' | 'nothing-to-turn-in' | 'cap-reached' }
    | {
        ok: true;
        dest: 'clan' | 'village';
        points: number;
        consumed: number;
        remaining: number;
        saveVersion: number;
    };

/**
 * Convert held caches into standing points at the type-locked ratio (docs §8,
 * decision B): War Supply cache → clan points ('clanRaid' source, 2:1), War
 * Resource cache → personal villageMerit (1:1). Points are clamped to the
 * destination's caps FIRST and only that many caches are consumed — a dump can
 * never burn caches for zero credit. All under the save lock, failClosed.
 * `count` ≤ 0 means "turn in everything held".
 */
export async function turnInCachesForSave(
    params: { playerName: string; cache: WarPool; count?: number },
    deps: StoreDeps = {},
): Promise<TurnInOutcome> {
    const { kv, lock, now } = resolve(deps);
    const t = now();
    const playerName = safeName(params.playerName);
    const itemId = cacheItemIdForPool(params.cache);

    return await lock(`save:${playerName}`, async () => {
        const saveKey = `save:${playerName}`;
        const rec = await kv.get<Record<string, unknown>>(saveKey);
        const char = rec?.character as Record<string, unknown> | undefined;
        if (!rec || !char) return { ok: false as const, error: 'no-save' as const };

        const stacks: Array<{ itemId: string; count: number }> = Array.isArray(char.itemStacks)
            ? (char.itemStacks as Array<{ itemId: string; count: number }>).map(s => ({ ...s }))
            : [];
        const stack = stacks.find(s => s.itemId === itemId);
        const held = stack ? Math.max(0, Math.floor(num(stack.count))) : 0;
        const want = params.count && params.count > 0 ? Math.min(Math.floor(params.count), held) : held;
        if (want <= 0) return { ok: false as const, error: 'nothing-to-turn-in' as const };

        const raw = turnInCaches(params.cache, want);
        if (raw.points <= 0) return { ok: false as const, error: 'nothing-to-turn-in' as const };

        let nextChar: Record<string, unknown>;
        let points: number;
        let consumed: number;

        if (raw.dest === 'clan') {
            if (!char.clan) return { ok: false as const, error: 'not-in-clan' as const };
            // Clamp to the award pipe's caps BEFORE consuming caches: per-award 250
            // + the weekly 1000 headroom — never consume more than what credits.
            const weekKey = clanPointWeekKey(new Date(t));
            const currentWeekly = String(char.weeklyClanPointsWeek ?? '') === weekKey
                ? Math.max(0, Math.floor(num(char.weeklyClanPoints))) : 0;
            const headroom = Math.max(0, CLAN_POINTS_WEEKLY_CAP - currentWeekly);
            points = Math.min(raw.points, MAX_CLAN_POINTS_AWARD, headroom);
            if (points <= 0) return { ok: false as const, error: 'cap-reached' as const };
            consumed = points * CLAN_CACHES_PER_POINT;
            const award = awardClanPoints(char, 'clanRaid', points, { eventId: `infil-turnin:${playerName}:${t}` }, new Date(t));
            if (award.awarded !== points) return { ok: false as const, error: 'cap-reached' as const };
            nextChar = award.character;
        } else {
            points = Math.min(raw.points, VILLAGE_TURNIN_MAX_POINTS);
            consumed = points; // 1:1
            nextChar = { ...char, villageMerit: meritNum(char.villageMerit) + points };
        }

        // Decrement the stack by what was actually consumed; drop empty stacks so
        // the array never accumulates zero-count entries.
        stack!.count = held - consumed;
        const nextStacks = stacks.filter(s => Math.max(0, Math.floor(num(s.count))) > 0);
        nextChar = { ...nextChar, itemStacks: nextStacks };

        const next = bumpSaveVersion({ ...rec, character: nextChar });
        await kv.set(saveKey, mergePreservingImages(next as Record<string, unknown>, rec));
        await kv.set(`${AUDIT_LOG_PREFIX}turnin:${playerName}:${t}`, {
            ts: t, playerName, cache: params.cache, dest: raw.dest, points, consumed,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);

        return {
            ok: true as const,
            dest: raw.dest,
            points,
            consumed,
            remaining: held - consumed,
            saveVersion: num((next as Record<string, unknown>)._saveVersion),
        };
    }, { failClosed: true });
}
