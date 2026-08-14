import { randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { writeVersionedPlayerSave } from '../save/_mutate-player-save.js';
import { gainXp } from '../_xp-engine.js';
import { compareWriteSoloPveSession, readSoloPveSession } from '../solo-pve/_store.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { settleSoloPveTerminalUsage } from '../solo-pve/_usage-authority.js';
import { hollowGateRunKey, HOLLOW_GATE_RUN_EXPIRED_MESSAGES, itemStackCount, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';
import {
    hollowGateCombatBindingKey,
    hollowGatePostWinHp,
    hollowGateCombatReward,
    hollowGateEncounterKey,
    HOLLOW_GATE_COMBAT_TTL_SECONDS,
    settleHollowGateCombatBinding,
    validateHollowGatePetClaim,
    validateHollowGateSoloPveSession,
    type HollowGateCombatBinding,
    type HollowGateCombatReward,
} from './_combat-session.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import {
    creditHollowGateLedger,
    HOLLOW_GATE_LEDGER_ITEM_IDS,
    hollowGateDeathRetention,
    normalizeHollowGateLedger,
    reconcileLedgerAmount,
    setCountedItem,
} from './_ledger.js';
import {
    appendHollowGateCombatSettlement,
    createHollowGateCombatPreparation,
    findHollowGateCombatSettlement,
    HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS,
    isHollowGateCombatReceipt,
    readHollowGateCombatPreparation,
    type HollowGateCombatPreparation,
    type HollowGateCombatReceipt,
} from './_combat-settlement-authority.js';

// bumpSaveVersion is performed by writeVersionedPlayerSave below; every
// successful settlement response echoes the resulting `_saveVersion`.

const HOSPITAL_DURATION_MS = 60_000;
const HG_FRAGMENT_ID = 'dungeon-legendary-fragment';
const ELEMENTAL_SHARD_ID = 'elemental-shard';
const VEIL_OF_THE_HOLLOW_ID = 'veil-of-the-hollow';
/**
 * A v2 worker writes its pre-save receipt immediately before its save write.
 * Production functions have a 30-second ceiling; the wider grace also covers
 * the Express storage retry budget. After this horizon, with both old lock
 * sentinels absent, the exact cached predecessor is safe to take over.
 */
export const HOLLOW_GATE_LEGACY_TAKEOVER_GRACE_MS = 5 * 60 * 1_000;

type LegacyCombatReceipt = {
    version?: 2;
    won: boolean;
    revived?: boolean;
    escaped?: boolean;
    petDefeat?: boolean;
    reward: HollowGateCombatReward;
    elementalShards: number;
    settledAt: number;
};
type CombatReceipt = HollowGateCombatReceipt;
type CachedCombatSettlement = CombatReceipt | LegacyCombatReceipt | HollowGateCombatPreparation;

type HollowGatePetResultReceipt = {
    playerName: string;
    runId: string;
    outcome: 'win' | 'loss' | 'draw';
    playerPetIds: string[];
    settledAt: number;
};

export function hollowGateCombatReceiptNeedsRecovery(
    receipt: Pick<LegacyCombatReceipt, 'version'>,
    appliedIds: readonly unknown[],
    runId: string,
): boolean {
    return receipt.version === 2 && !appliedIds.includes(runId);
}

function promoteLegacyCombatReceipt(value: unknown): CombatReceipt | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const version = (value as { version?: unknown }).version;
    if (version !== 2 && version !== 3) return null;
    const promoted = { ...(value as Record<string, unknown>), version: 3 };
    return isHollowGateCombatReceipt(promoted) ? promoted : null;
}

function saveOwnsPreparedHollowRun(
    character: Record<string, unknown>,
    token: string,
    preparation: Pick<HollowGateCombatPreparation, 'binding' | 'run'>,
): boolean {
    const savedRun = character.hollowGateRun && typeof character.hollowGateRun === 'object'
        && !Array.isArray(character.hollowGateRun)
        ? character.hollowGateRun as Record<string, unknown>
        : null;
    return !!savedRun
        && savedRun.runToken === token
        && savedRun.serverSeed === preparation.run.seed
        && Math.floor(Number(savedRun.floor)) === preparation.binding.floor;
}

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function addCountedItem(itemStacks: unknown, itemId: string, amountRaw: unknown): Array<Record<string, unknown>> {
    const amount = Math.max(0, Math.floor(num(amountRaw)));
    const stacks = Array.isArray(itemStacks) ? itemStacks as Array<Record<string, unknown>> : [];
    if (!amount) return stacks;
    let found = false;
    const next = stacks.map((stack) => {
        if (!stack || String(stack.itemId ?? '') !== itemId) return stack;
        found = true;
        return { ...stack, count: Math.max(0, Math.floor(num(stack.count))) + amount };
    });
    return found ? next : [...next, { itemId, count: amount }];
}

async function confirmedCompareSet(
    key: string,
    expected: unknown | null,
    next: unknown,
    options?: { ex?: number },
): Promise<void> {
    try {
        if (await kv.compareSet(key, expected, next, options)) return;
    } catch (error) {
        const readback = await kv.get(key).catch(() => null);
        if (isDeepStrictEqual(readback, next)) return;
        throw error;
    }
    const readback = await kv.get(key).catch(() => null);
    if (!isDeepStrictEqual(readback, next)) throw new Error(`hollow-gate-cas-conflict:${key}`);
}

async function confirmCombatReceiptCache(
    key: string,
    receipt: CombatReceipt,
    identity: { playerName: string; token: string; runId: string },
    expected?: CachedCombatSettlement | null,
): Promise<void> {
    const current = await kv.get<unknown>(key);
    if (isDeepStrictEqual(current, receipt)) return;
    // A legacy-first migration can crash after its save marker CAS and before
    // upgrading the exact v2 cache receipt. The in-save marker is durable
    // proof, so this one-field normalization is safe and keeps retry live.
    const normalizedLegacy = current && typeof current === 'object' && !Array.isArray(current)
        && (current as { version?: unknown }).version === 2
        ? { ...(current as Record<string, unknown>), version: 3 }
        : null;
    if (normalizedLegacy && isDeepStrictEqual(normalizedLegacy, receipt)) {
        await confirmedCompareSet(key, current, receipt, { ex: HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS });
        return;
    }
    if (expected !== undefined && !isDeepStrictEqual(current, expected)) {
        throw new Error('hollow-gate-receipt-cache-predecessor-conflict');
    }
    const preparation = readHollowGateCombatPreparation(current, identity);
    if (preparation === 'invalid') throw new Error('hollow-gate-preparation-invalid');
    if (preparation && !isDeepStrictEqual(preparation.receipt, receipt)) {
        throw new Error('hollow-gate-preparation-receipt-conflict');
    }
    if (current !== null && !preparation && expected === undefined) {
        throw new Error('hollow-gate-receipt-cache-conflict');
    }
    await confirmedCompareSet(key, current, receipt, { ex: HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS });
}

async function reserveCombatPreparation(
    key: string,
    preparation: HollowGateCombatPreparation,
): Promise<CachedCombatSettlement> {
    const current = await kv.get<CachedCombatSettlement>(key);
    if (current !== null) return current;
    try {
        if (await kv.compareSet(key, null, preparation, { ex: HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS }) === true) {
            return preparation;
        }
    } catch (error) {
        const readback = await kv.get<CachedCombatSettlement>(key).catch(() => null);
        if (isDeepStrictEqual(readback, preparation)) return preparation;
        throw error;
    }
    const raced = await kv.get<CachedCombatSettlement>(key);
    if (!raced) throw new Error('hollow-gate-preparation-unconfirmed');
    return raced;
}

async function replaceLegacyCombatPreparation(
    key: string,
    legacy: LegacyCombatReceipt,
    preparation: HollowGateCombatPreparation,
): Promise<CachedCombatSettlement> {
    try {
        if (await kv.compareSet(key, legacy, preparation, { ex: HOLLOW_GATE_COMBAT_RECEIPT_TTL_SECONDS }) === true) {
            return preparation;
        }
    } catch (error) {
        const readback = await kv.get<CachedCombatSettlement>(key).catch(() => null);
        if (isDeepStrictEqual(readback, preparation)) return preparation;
        throw error;
    }
    const raced = await kv.get<CachedCombatSettlement>(key);
    if (!raced) throw new Error('hollow-gate-legacy-takeover-unconfirmed');
    return raced;
}

async function persistSoloPveCombatSettlement(
    session: NonNullable<Awaited<ReturnType<typeof readSoloPveSession>>>,
    binding: HollowGateCombatBinding,
    receipt: CombatReceipt,
): Promise<void> {
    if (session.status !== 'done' || session.settlementState === 'settled') return;
    const settled = withSoloPveSettlementReceipt(session, {
        kind: 'hollow-gate',
        id: binding.runId,
        settledAt: receipt.settledAt,
        rewards: { outcome: session.outcome ?? 'loss', won: receipt.won },
    });
    if (await compareWriteSoloPveSession(session, settled)) return;
    const readback = await readSoloPveSession(session.sessionId);
    if (!readback
        || readback.settlementState !== 'settled'
        || readback.terminalEvidence?.receipt?.kind !== 'hollow-gate'
        || readback.terminalEvidence.receipt.id !== binding.runId) {
        throw new Error('hollow-gate-session-settlement-conflict');
    }
}

async function persistRunCombatSettlement(
    runKey: string,
    run: HollowGateRunToken,
    binding: HollowGateCombatBinding,
    receipt: CombatReceipt,
): Promise<void> {
    const encounterKey = hollowGateEncounterKey(binding.floor, binding.kind, binding.nodeId);
    const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
    const alreadyResolved = resolved.includes(encounterKey);
    const paid = receipt.reward;
    const activeIsThisFight = run.activeEncounter?.runId === binding.runId;
    if (!activeIsThisFight && !alreadyResolved) {
        await confirmedCompareSet(
            hollowGateCombatBindingKey(binding.runId),
            binding,
            settleHollowGateCombatBinding(binding, receipt.won, receipt.settledAt),
            { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS },
        );
        return;
    }
    const ledgerResult = receipt.won && !alreadyResolved
        ? creditHollowGateLedger(run, `combat:${encounterKey}`, {
            currencies: {
                ryo: paid.ryo,
                auraDust: paid.auraDust,
                honorSeals: paid.honorSeals,
                boneCharms: paid.boneCharms,
                fateShards: paid.fateShards,
                hollowShards: paid.hollowShards,
            },
            items: {
                [HG_FRAGMENT_ID]: paid.fragments,
                [VEIL_OF_THE_HOLLOW_ID]: paid.veils,
                [ELEMENTAL_SHARD_ID]: receipt.elementalShards,
            },
        })
        : { ledger: normalizeHollowGateLedger(run), alreadyCredited: true };
    const nextRun: HollowGateRunToken = {
        ...run,
        ...(activeIsThisFight ? { activeEncounter: null } : {}),
        ...(activeIsThisFight ? { threat: 0, pendingAmbush: null } : {}),
        ...(receipt.revived ? { secondWindArmed: false } : {}),
        resolvedEncounterIds: receipt.revived || receipt.escaped || receipt.petDefeat || alreadyResolved
            ? resolved
            : [...resolved.slice(-127), encounterKey],
        rewardLedger: ledgerResult.ledger,
        serverCreditedCurrencies: ledgerResult.ledger.currencies,
    };
    if (!receipt.won && !receipt.revived && !receipt.escaped && !receipt.petDefeat) {
        // JSON compare-delete is not part of the storage contract. Fence the
        // exact run into a one-second terminal tombstone instead; it cannot
        // erase a successor written after the run lock expires.
        await confirmedCompareSet(runKey, run, nextRun, { ex: 1 });
    } else {
        await confirmedCompareSet(runKey, run, nextRun);
    }
    await confirmedCompareSet(
        hollowGateCombatBindingKey(binding.runId),
        binding,
        settleHollowGateCombatBinding(binding, receipt.won, receipt.settledAt),
        { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS },
    );
}

function applyPreparedCombatPayout(
    character: Record<string, unknown>,
    preparation: HollowGateCombatPreparation,
): Record<string, unknown> {
    const { binding, receipt, run, settlementSession, survivingHp, petIds } = preparation;
    const { won, revived, escaped, petDefeat, reward, elementalShards } = receipt;
    let next = binding.combatMode === 'solo-pve' && settlementSession
        ? applySoloPveUsageCosts({ ...character }, settlementSession)
        : { ...character };
    if (binding.combatMode === 'pet' && petIds.length) {
        const pets = Array.isArray(next.pets) ? next.pets as Array<Record<string, unknown>> : [];
        next.pets = pets.map((pet) => petIds.includes(String(pet?.id ?? '')) && pet.loadout && typeof pet.loadout === 'object'
            ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
            : pet);
    }
    if (won) {
        next = gainXp(next, reward.xp) as Record<string, unknown>;
        next.hp = binding.combatMode === 'pet'
            ? Math.max(1, Math.min(Math.floor(num(next.maxHp) || 1), Math.floor(num(next.hp) || 1)))
            : hollowGatePostWinHp(next.maxHp, survivingHp, binding.kind);
        next.ryo = num(next.ryo) + reward.ryo;
        next.auraDust = num(next.auraDust) + reward.auraDust;
        next.honorSeals = num(next.honorSeals) + reward.honorSeals;
        next.boneCharms = num(next.boneCharms) + reward.boneCharms;
        next.fateShards = num(next.fateShards) + reward.fateShards;
        next.hollowShards = num(next.hollowShards) + reward.hollowShards;
        next.itemStacks = addCountedItem(next.itemStacks, HG_FRAGMENT_ID, reward.fragments);
        next.itemStacks = addCountedItem(next.itemStacks, VEIL_OF_THE_HOLLOW_ID, reward.veils);
        next.itemStacks = addCountedItem(next.itemStacks, ELEMENTAL_SHARD_ID, elementalShards);
        if (binding.kind === 'boss') next.hollowGateWardenKills = num(next.hollowGateWardenKills) + 1;
        if (next.hollowGateRun && typeof next.hollowGateRun === 'object') {
            const nextRun = { ...(next.hollowGateRun as Record<string, unknown>) };
            delete nextRun.activeCombat;
            next.hollowGateRun = nextRun;
        }
    } else if (petDefeat) {
        const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
            ? next.hollowGateRun as Record<string, unknown>
            : {};
        const recoil = Math.max(1, Math.floor(num(next.maxHp) * 0.20));
        next = {
            ...next,
            hp: Math.max(1, Math.floor(num(next.hp)) - recoil),
            hospitalized: false,
            hollowGateRun: { ...savedRun, threat: 0, activeCombat: undefined },
        };
    } else if (escaped) {
        const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
            ? next.hollowGateRun as Record<string, unknown>
            : {};
        next = {
            ...next,
            hp: Math.min(
                Math.max(1, Math.floor(num(next.hp) || 1)),
                Math.max(1, Math.floor(survivingHp || 1)),
            ),
            hospitalized: false,
            hollowGateRun: { ...savedRun, threat: 0, activeCombat: undefined },
        };
    } else if (revived) {
        const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
            ? next.hollowGateRun as Record<string, unknown>
            : {};
        next = {
            ...next,
            hp: Math.max(1, Math.floor(num(next.maxHp) * 0.5)),
            hospitalized: false,
            hospitalizedAt: 0,
            hospitalizedUntil: 0,
            hollowGateRun: { ...savedRun, secondWindArmed: false, threat: 0, activeCombat: undefined },
        };
    } else {
        const ledger = normalizeHollowGateLedger(run);
        const retention = hollowGateDeathRetention(next);
        for (const key of ['ryo', 'auraDust', 'auraStones', 'boneCharms', 'fateShards', 'honorSeals', 'hollowShards']) {
            next[key] = reconcileLedgerAmount(
                next[key],
                run.entryCurrencies[key as keyof typeof run.entryCurrencies],
                ledger.currencies[key as keyof typeof ledger.currencies],
                retention,
            );
        }
        for (const itemId of HOLLOW_GATE_LEDGER_ITEM_IDS) {
            const current = itemStackCount(next.itemStacks, itemId);
            const entry = run.entryItems ? num(run.entryItems[itemId]) : current;
            next.itemStacks = setCountedItem(
                next.itemStacks,
                itemId,
                reconcileLedgerAmount(current, entry, ledger.items[itemId], 1),
            );
        }
        next = {
            ...next,
            hp: 0,
            hospitalized: true,
            hospitalizedAt: receipt.settledAt,
            hospitalizedUntil: receipt.settledAt + HOSPITAL_DURATION_MS,
            hollowGateRun: null,
        };
    }
    const settledIds = Array.isArray(next.settledHollowGateCombatIds)
        ? (next.settledHollowGateCombatIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    next.settledHollowGateCombatIds = [...settledIds.filter((id) => id !== binding.runId).slice(-199), binding.runId];
    return next;
}

/** Idempotently banks the server-recorded combat result and clears the run's active encounter. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const runId = String(body.runId ?? '').slice(0, 96);
        const petReceipt = typeof body.petReceipt === 'string' && /^[A-Za-z0-9]+$/.test(body.petReceipt)
            ? body.petReceipt
            : '';
        if (!playerName || !token || !runId) return res.status(400).json({ error: 'Missing Hollow Gate combat identity.' });
        if (!enforceRateLimit(req, res, 'hollow-gate-combat-settle', 30, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });

        const bindingKey = hollowGateCombatBindingKey(runId);
        const receiptKey = `hg-combat-paid:${runId}`;
        const [storedInitialBinding, storedInitialSettlement] = await Promise.all([
            kv.get<HollowGateCombatBinding>(bindingKey),
            kv.get<CachedCombatSettlement>(receiptKey),
        ]);
        const initialPreparation = readHollowGateCombatPreparation(storedInitialSettlement, { playerName, token, runId });
        if (initialPreparation === 'invalid') return res.status(409).json({ error: 'The Hollow Gate preparation journal is invalid.' });
        const initialBinding = storedInitialBinding ?? initialPreparation?.binding ?? null;
        if (!initialBinding || initialBinding.playerName !== playerName) return res.status(404).json({ error: 'Encounter not found.' });

        const runKey = hollowGateRunKey(playerName, token);
        const saveKey = `save:${playerName}`;
        const cacheIdentity = { playerName, token, runId };
        const initialLegacyReceipt = promoteLegacyCombatReceipt(storedInitialSettlement);
        const legacyTakeoverEligible = initialLegacyReceipt
            && Date.now() - initialLegacyReceipt.settledAt >= HOLLOW_GATE_LEGACY_TAKEOVER_GRACE_MS
            && !(await kv.get(`lock:${runKey}`).catch(() => 'unavailable'))
            && !(await kv.get(`lock:${saveKey}`).catch(() => 'unavailable'));
        const result = await withKvLock(runKey, async () => {
            let [run, liveBinding, session, storedReceipt, initialRecord] = await Promise.all([
                kv.get<HollowGateRunToken>(runKey),
                kv.get<HollowGateCombatBinding>(bindingKey),
                readSoloPveSession(runId),
                kv.get<CachedCombatSettlement>(receiptKey),
                kv.get<Record<string, unknown>>(saveKey),
            ]);
            let preparation = readHollowGateCombatPreparation(storedReceipt, cacheIdentity);
            if (preparation === 'invalid') return { status: 409, body: { error: 'The Hollow Gate preparation journal is invalid.' } };
            let binding = preparation?.binding ?? liveBinding;
            if (!binding || binding.playerName !== playerName) return { status: 404, body: { error: 'Encounter not found.' } };

            const advanceDownstream = async (
                receipt: CombatReceipt,
                recoverySession: typeof session,
            ): Promise<void> => {
                const [currentRun, currentBinding, currentSession] = await Promise.all([
                    kv.get<HollowGateRunToken>(runKey),
                    kv.get<HollowGateCombatBinding>(bindingKey),
                    readSoloPveSession(runId),
                ]);
                const advanceBinding = currentBinding ?? binding!;
                if (currentRun && currentBinding) {
                    await persistRunCombatSettlement(runKey, currentRun, advanceBinding, receipt);
                } else if (currentBinding?.status === 'active' && !currentBinding.settledAt) {
                    await confirmedCompareSet(
                        bindingKey,
                        currentBinding,
                        settleHollowGateCombatBinding(currentBinding, receipt.won, receipt.settledAt),
                        { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS },
                    );
                }
                const terminal = currentSession ?? recoverySession;
                if (advanceBinding.combatMode === 'solo-pve' && terminal) {
                    await persistSoloPveCombatSettlement(terminal, advanceBinding, receipt);
                }
            };

            const initialCharacter = initialRecord?.character as Record<string, unknown> | undefined;
            if (initialCharacter) {
                const marker = findHollowGateCombatSettlement({ character: initialCharacter, playerName, token, binding });
                if (marker === 'invalid') {
                    return { status: 409, body: { error: 'The Hollow Gate combat settlement manifest is invalid.' } };
                }
                if (marker) {
                    await confirmCombatReceiptCache(receiptKey, marker.receipt, cacheIdentity);
                    await advanceDownstream(marker.receipt, session);
                    return { status: 200, body: {
                        ok: true,
                        alreadyReported: true,
                        won: marker.receipt.won,
                        revived: marker.receipt.revived ?? false,
                        escaped: marker.receipt.escaped ?? false,
                        petDefeat: marker.receipt.petDefeat ?? false,
                        reward: marker.receipt.reward,
                        elementalShards: marker.receipt.elementalShards,
                        character: initialCharacter,
                        _saveVersion: Number(initialRecord?._saveVersion ?? 0),
                    } };
                }

                const legacyIds = Array.isArray(initialCharacter.settledHollowGateCombatIds)
                    ? initialCharacter.settledHollowGateCombatIds as unknown[]
                    : [];
                if (storedReceipt && (storedReceipt.version === 2 || storedReceipt.version === 3) && legacyIds.includes(runId)) {
                    const legacyReceipt: CombatReceipt = { ...storedReceipt, version: 3 } as CombatReceipt;
                    const migrated = await withKvLock(saveKey, async () => {
                        const record = await kv.get<Record<string, unknown>>(saveKey);
                        const character = record?.character as Record<string, unknown> | undefined;
                        if (!record || !character) return null;
                        const currentLegacyIds = Array.isArray(character.settledHollowGateCombatIds)
                            ? character.settledHollowGateCombatIds as unknown[]
                            : [];
                        if (!currentLegacyIds.includes(runId)) {
                            throw new Error('hollow-gate-legacy-save-proof-lost');
                        }
                        const existing = findHollowGateCombatSettlement({ character, playerName, token, binding: binding! });
                        if (existing === 'invalid') throw new Error('hollow-gate-combat-settlement-manifest-invalid');
                        if (existing) return { character, saveVersion: Number(record._saveVersion ?? 0) };
                        const appended = appendHollowGateCombatSettlement({
                            character,
                            playerName,
                            token,
                            binding: binding!,
                            receipt: legacyReceipt,
                            now: legacyReceipt.settledAt,
                        });
                        if (!appended.ok) throw new Error(appended.error);
                        const updated = await writeVersionedPlayerSave(saveKey, record, appended.character);
                        return { character: appended.character, saveVersion: updated._saveVersion };
                    }, { failClosed: true, ttlSec: 10 });
                    if (!migrated) return { status: 404, body: { error: 'Player save not found.' } };
                    await confirmCombatReceiptCache(receiptKey, legacyReceipt, cacheIdentity, storedReceipt);
                    await advanceDownstream(legacyReceipt, session);
                    return { status: 200, body: {
                        ok: true,
                        alreadyReported: true,
                        won: legacyReceipt.won,
                        revived: legacyReceipt.revived ?? false,
                        escaped: legacyReceipt.escaped ?? false,
                        petDefeat: legacyReceipt.petDefeat ?? false,
                        reward: legacyReceipt.reward,
                        elementalShards: legacyReceipt.elementalShards,
                        character: migrated.character,
                        _saveVersion: migrated.saveVersion,
                    } };
                }
            }

            if (!preparation) {
                const legacyOrphan = promoteLegacyCombatReceipt(storedReceipt);
                const mayTakeOverLegacy = !!legacyTakeoverEligible
                    && !!legacyOrphan
                    && isDeepStrictEqual(storedReceipt, storedInitialSettlement)
                    && isDeepStrictEqual(legacyOrphan, initialLegacyReceipt);
                if (storedReceipt && !mayTakeOverLegacy) {
                    return { status: 409, body: { error: 'A prior Hollow Gate settlement is still awaiting durable save proof.' } };
                }
                if (!liveBinding || liveBinding.status !== 'active' || liveBinding.settledAt) {
                    return { status: 409, body: { error: 'The encounter is settled but its reward receipt is unavailable.' } };
                }
                if (!run) return { status: 409, body: { error: HOLLOW_GATE_RUN_EXPIRED_MESSAGES.combatSettle } };
                binding = liveBinding;
                let won = false;
                let escaped = false;
                let petDefeat = false;
                let petIds: string[] = [];
                let survivingHp = 0;
                let settlementSession = session;
                if (binding.combatMode === 'pet') {
                    const validation = validateHollowGatePetClaim({ binding, activeEncounter: run.activeEncounter, playerName, token });
                    if (!validation.ok) return { status: 409, body: { error: `Hollow Gate pet settlement rejected: ${validation.reason}.` } };
                    if (!petReceipt) return { status: 400, body: { error: 'A server-verified Hollow Hound pet result is required.' } };
                    const verifiedPetResult = await kv.get<HollowGatePetResultReceipt>(`hg-pet-result:${playerName}:${petReceipt}`);
                    if (!verifiedPetResult || verifiedPetResult.playerName !== playerName || verifiedPetResult.runId !== runId) {
                        return { status: 409, body: { error: 'The Hollow Hound pet result is invalid, expired, or belongs to another encounter.' } };
                    }
                    won = verifiedPetResult.outcome === 'win';
                    petDefeat = !won;
                    petIds = Array.isArray(verifiedPetResult.playerPetIds) ? verifiedPetResult.playerPetIds : [];
                } else {
                    const validation = validateHollowGateSoloPveSession({ binding, session, activeEncounter: run.activeEncounter, playerName, token });
                    if (!validation.ok) return { status: 409, body: { error: `Hollow Gate settlement rejected: ${validation.reason}.` } };
                    won = session!.outcome === 'win';
                    escaped = session!.outcome === 'fled';
                    survivingHp = Math.max(0, Math.floor(Number(session!.player.hp) || 0));
                    const usage = await settleSoloPveTerminalUsage(session!, playerName);
                    if (!usage.ok) return { status: usage.status, body: { error: usage.error } };
                    settlementSession = usage.session;
                }
                const payoutRecord = await kv.get<Record<string, unknown>>(saveKey);
                const payoutCharacter = payoutRecord?.character as Record<string, unknown> | undefined;
                if (!payoutRecord || !payoutCharacter) return { status: 404, body: { error: 'Player save not found.' } };
                if (!saveOwnsPreparedHollowRun(payoutCharacter, token, { binding, run })) {
                    return { status: 409, body: { error: 'The saved Hollow Gate run changed before this combat could settle.' } };
                }
                const revived = !won && !escaped && !petDefeat && binding.secondWindArmed === true;
                const reward = won
                    ? hollowGateCombatReward(binding.floor, binding.kind, payoutCharacter.profession)
                    : hollowGateCombatReward(binding.floor, binding.kind, undefined);
                if (won) {
                    const multiplier = rewardMultiplierForToken(run);
                    for (const key of ['ryo', 'auraDust', 'honorSeals', 'boneCharms', 'fateShards', 'hollowShards'] as const) {
                        reward[key] = Math.floor(reward[key] * multiplier);
                    }
                } else {
                    for (const key of Object.keys(reward) as Array<keyof HollowGateCombatReward>) reward[key] = 0;
                }
                const elementalShards = won && binding.kind === 'boss'
                    && randomInt(0, 10_000) < Math.floor(Math.min(0.8, 0.5 + binding.floor * 0.03) * 10_000) ? 1 : 0;
                const generatedReceipt: CombatReceipt = {
                    version: 3, won, revived, escaped, petDefeat, reward, elementalShards, settledAt: Date.now(),
                };
                const receipt = mayTakeOverLegacy ? legacyOrphan! : generatedReceipt;
                if (mayTakeOverLegacy) {
                    const eligibleShard = won && binding.kind === 'boss'
                        ? receipt.elementalShards === 0 || receipt.elementalShards === 1
                        : receipt.elementalShards === 0;
                    if (receipt.won !== won
                        || (receipt.revived ?? false) !== revived
                        || (receipt.escaped ?? false) !== escaped
                        || (receipt.petDefeat ?? false) !== petDefeat
                        || !isDeepStrictEqual(receipt.reward, reward)
                        || !eligibleShard) {
                        return { status: 409, body: { error: 'The legacy Hollow Gate receipt does not match the live encounter authority.' } };
                    }
                }
                const candidate = createHollowGateCombatPreparation({
                    playerName,
                    token,
                    binding,
                    receipt,
                    run,
                    settlementSession,
                    survivingHp,
                    petIds,
                });
                const reserved = mayTakeOverLegacy
                    ? await replaceLegacyCombatPreparation(receiptKey, storedReceipt as LegacyCombatReceipt, candidate)
                    : await reserveCombatPreparation(receiptKey, candidate);
                preparation = readHollowGateCombatPreparation(reserved, cacheIdentity);
                if (preparation === 'invalid') {
                    return { status: 409, body: { error: 'The Hollow Gate preparation journal conflicts with this settlement.' } };
                }
                if (!preparation) {
                    return { status: 409, body: { error: 'A rolling Hollow Gate v2 settlement won the receipt reservation; retry after it finishes.' } };
                }
                storedReceipt = reserved;
            }

            const sealedPreparation = preparation;
            binding = sealedPreparation.binding;
            const banked = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const character = record?.character as Record<string, unknown> | undefined;
                if (!record || !character) return null;
                const existing = findHollowGateCombatSettlement({ character, playerName, token, binding: binding! });
                if (existing === 'invalid') throw new Error('hollow-gate-combat-settlement-manifest-invalid');
                if (existing) {
                    return { receipt: existing.receipt, character, saveVersion: Number(record._saveVersion ?? 0), replayed: true };
                }
                if (!saveOwnsPreparedHollowRun(character, token, sealedPreparation)) {
                    return { runConflict: true as const };
                }
                let next = applyPreparedCombatPayout(character, sealedPreparation);
                const appended = appendHollowGateCombatSettlement({
                    character: next,
                    playerName,
                    token,
                    binding: binding!,
                    receipt: sealedPreparation.receipt,
                    now: sealedPreparation.receipt.settledAt,
                });
                if (!appended.ok) throw new Error(appended.error);
                next = appended.character;
                try {
                    const updated = await writeVersionedPlayerSave(saveKey, record, next);
                    return { receipt: sealedPreparation.receipt, character: next, saveVersion: updated._saveVersion, replayed: false };
                } catch (error) {
                    const readback = await kv.get<Record<string, unknown>>(saveKey).catch(() => null);
                    const readbackCharacter = readback?.character as Record<string, unknown> | undefined;
                    const raced = readbackCharacter
                        ? findHollowGateCombatSettlement({ character: readbackCharacter, playerName, token, binding: binding! })
                        : null;
                    if (!raced || raced === 'invalid') throw error;
                    return {
                        receipt: raced.receipt,
                        character: readbackCharacter!,
                        saveVersion: Number(readback?._saveVersion ?? 0),
                        replayed: true,
                    };
                }
            }, { failClosed: true, ttlSec: 10 });
            if (!banked) return { status: 404, body: { error: 'Player save not found.' } };
            if ('runConflict' in banked) {
                return { status: 409, body: { error: 'A newer Hollow Gate run owns the saved character; the older payout remains safely pending.' } };
            }

            await confirmCombatReceiptCache(receiptKey, banked.receipt, cacheIdentity, sealedPreparation);
            await advanceDownstream(banked.receipt, sealedPreparation.settlementSession);
            return { status: 200, body: {
                ok: true,
                ...(banked.replayed ? { alreadyReported: true } : {}),
                won: banked.receipt.won,
                revived: banked.receipt.revived ?? false,
                escaped: banked.receipt.escaped ?? false,
                petDefeat: banked.receipt.petDefeat ?? false,
                reward: banked.receipt.reward,
                elementalShards: banked.receipt.elementalShards,
                character: banked.character,
                _saveVersion: banked.saveVersion,
            } };
        }, { failClosed: true, ttlSec: 15 });

        if (result.status === 200) {
            const resultBody = result.body as Record<string, unknown>;
            const outcome = resultBody.won === true
                ? 'win'
                : resultBody.escaped === true
                    ? 'escaped'
                    : resultBody.revived === true
                        ? 'revived'
                        : 'loss';
            await recordBetaMetric({
                event: resultBody.alreadyReported === true
                    ? 'hollow_gate.combat_settle_replayed'
                    : 'hollow_gate.combat_settled',
                playerName,
                source: `${initialBinding.combatMode}:floor-${initialBinding.floor}:${initialBinding.kind}:${outcome}`,
            });
        }
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[hollow-gate/combat-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
