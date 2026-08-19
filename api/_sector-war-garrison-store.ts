/*
 * Sector War Garrison Assault — KV storage.
 *
 * Mirrors the run-record shape of api/_anbu-infiltration-store.ts (InfilRun),
 * scoped to garrison: the authoritative binding from a Combat sector-war
 * contest's attacker to the ANBU snapshot they're assaulting, plus a durable
 * settlement receipt on the ATTACKER'S OWN save (item usage + surviving
 * HP/hospital — this is a real multi-turn fight now, not a free instant
 * dice-roll, so it costs the same as any other sealed AI fight). The CONTEST
 * scoring itself is NOT settled here — that stays api/village/sector-war.ts's
 * job, under the contest's own lock, reusing the exact same
 * applySectorWarBattle/GARRISON_POINTS_CAP machinery a live-defender fight
 * uses (api/_sector-war.ts).
 *
 * ANBU roster/snapshot selection is NOT duplicated here. loadAnbuAppointees /
 * pickAnbuDefender / getOrSealAnbuSnapshot are re-exported straight from
 * api/_anbu-infiltration-store.ts — "read the jutsu/equipment/weapons/items…
 * and use it all properly" is exactly what that store already does, tested,
 * for a different attacker; garrison just picks a different village's ANBU
 * for a different contest.
 */
import { kv as realKv, type KvLike } from './_storage.js';
import { withKvLock as realWithKvLock, type LockOptions } from './_lock.js';
import { mergePreservingImages } from './_utils.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from './_settlement-receipts.js';
import { applySoloPveUsageCosts } from './solo-pve/_settlement.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import { applyAiFightOutcomeToCharacter, resolveAiFightOutcome } from './missions/_ai-fight-outcome.js';

export {
    loadAnbuAppointees,
    pickAnbuDefender,
    getOrSealAnbuSnapshot,
    type AnbuSnapshot,
} from './_anbu-infiltration-store.js';

// ─── injectable deps ─────────────────────────────────────────────────────────
export type GarrisonKv = Pick<KvLike, 'get' | 'set' | 'del' | 'compareSet'>;
export type GarrisonLock = <T>(target: string, fn: () => Promise<T>, options?: LockOptions) => Promise<T>;
export type StoreDeps = { kv?: GarrisonKv; lock?: GarrisonLock; now?: () => number };
function resolve(deps: StoreDeps) {
    return {
        kv: deps.kv ?? realKv,
        lock: deps.lock ?? realWithKvLock,
        now: deps.now ?? (() => Date.now()),
    };
}

// ─── key scheme ──────────────────────────────────────────────────────────────
export const garrisonRunKey = (runId: string) => `sector-war-garrison:${runId}`;
export const garrisonActiveRunKey = (attackerName: string, sector: number) =>
    `sector-war-garrison-active:${attackerName}:${Math.floor(Number(sector) || 0)}`;

export const GARRISON_RUN_TTL = 60 * 60;              // outlives the 45-minute combat TTL
export const GARRISON_TERMINAL_RUN_TTL = 7 * 24 * 60 * 60;

/** The authoritative live run binding plus sealed assault context (which
 *  contest, which ANBU defends). All scoring parameters derive from THIS
 *  record at resolve — never from the client. */
export interface GarrisonRun {
    runId: string;
    attackerName: string;
    attackerVillage: string;
    sector: number;
    /** the sector-war contest id this assault is bound to */
    contestId: string;
    defenderVillage: string;
    /** which appointed ANBU is defending this run */
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

export async function readGarrisonRun(runId: string, deps: StoreDeps = {}): Promise<GarrisonRun | null> {
    const { kv } = resolve(deps);
    return await kv.get<GarrisonRun>(garrisonRunKey(runId));
}

export async function writeGarrisonRun(run: GarrisonRun, deps: StoreDeps = {}): Promise<void> {
    const { kv } = resolve(deps);
    await kv.set(garrisonRunKey(run.runId), run, { ex: run.settlement ? GARRISON_TERMINAL_RUN_TTL : GARRISON_RUN_TTL });
}

export async function deleteGarrisonRun(runId: string, deps: StoreDeps = {}): Promise<void> {
    const { kv } = resolve(deps);
    await kv.del(garrisonRunKey(runId));
}

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export type SettleGarrisonFightOutcome =
    | { ok: true; alreadySettled: boolean; saveVersion: number; character: Record<string, unknown> }
    | { ok: false; error: 'no-save' | 'receipt-conflict' };

/**
 * Persist the fight's physical consequence onto the ATTACKER's own save:
 * proven item usage plus surviving HP / a hospital stay on a knockout, exactly
 * like every other sealed AI fight (api/missions/_ai-fight-outcome.ts). This
 * runs regardless of win/loss/draw — a garrison assault is a real multi-turn
 * fight now, so losing (or even winning) still burns potions/chakra items and
 * can send the attacker to the hospital. Without this, garrison-start /
 * garrison-resolve would be a free, consequence-free item-farm against a real
 * AI opponent, since garrison itself pays the attacker no reward at all.
 *
 * Idempotent via a settlement receipt on the character (separate from the run
 * record's own `settlement` cache — the two writes are not atomic with each
 * other), mirroring settleInfiltrationLoss in _anbu-infiltration-store.ts.
 */
export async function settleGarrisonFight(
    run: GarrisonRun,
    session: SoloPveSession,
    deps: StoreDeps = {},
): Promise<SettleGarrisonFightOutcome> {
    const { kv, lock, now } = resolve(deps);
    return lock(`save:${run.attackerName}`, async () => {
        const saveKey = `save:${run.attackerName}`;
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const character = record?.character as Record<string, unknown> | undefined;
        if (!record || !character) return { ok: false as const, error: 'no-save' as const };
        const receiptId = `sector-war-garrison-${run.runId}`.slice(0, 80);
        const fingerprint = `${run.attackerName}:${run.sector}:${run.contestId}:${run.anbuSlug}`;
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
            value: { kind: 'sector-war-garrison', outcome: session.outcome ?? 'unknown' },
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
