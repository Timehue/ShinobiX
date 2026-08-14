import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyDerivedLevel, type XpCharacter } from './_xp-engine.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from './_settlement-receipts.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from './save/_mutate-player-save.js';

export const WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD = 'weeklyBossPayoutSettlements';
export const WEEKLY_BOSS_PAYOUT_SETTLEMENT_LIMIT = 64;
const WEEKLY_BOSS_PAYOUT_ACTIVE_HARD_LIMIT = 512;
const WEEKLY_BOSS_PAYOUT_RECOVERY_MS = 35 * 24 * 60 * 60 * 1_000;
const WEEKLY_BOSS_STAT_POINTS = 10;
const WEEKLY_BOSS_CORE_ID = 'weekly-boss-core';
const DUNGEON_KEY_ID = 'dungeon-key';

export type WeeklyBossPayout = {
    playerName: string;
    weekKey: string;
    bossStartedAt: number;
    aiId: string;
    ryo: number;
    gotCore: boolean;
    gotKey: boolean;
};

type WeeklyBossPayoutMarker = {
    version: 1 | 2;
    weekKey: string;
    bossStartedAt?: number;
    aiId: string;
    fingerprint: string;
    ryo: number;
    gotCore: boolean;
    gotKey: boolean;
    creditedAt: number;
    recoverUntil: number;
    bossAcknowledgedAt?: number;
};

export type WeeklyBossPayoutCreditResult =
    | {
        ok: true;
        replayed: boolean;
        migratedLegacy: boolean;
        creditedAt: number;
        character: Record<string, unknown>;
        _saveVersion: number;
    }
    | { ok: false; status: number; error: string };

export type WeeklyBossPayoutAckResult =
    | { ok: true; replayed: boolean; acknowledgedAt: number; character: Record<string, unknown>; _saveVersion: number }
    | { ok: false; status: number; error: string };

function safeAmount(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function payoutFingerprint(payout: WeeklyBossPayout): string {
    return createHash('sha256').update(JSON.stringify({
        version: 2,
        playerName: payout.playerName.toLowerCase(),
        weekKey: payout.weekKey,
        bossStartedAt: payout.bossStartedAt,
        aiId: payout.aiId,
        ryo: payout.ryo,
        gotCore: payout.gotCore,
        gotKey: payout.gotKey,
        statPoints: WEEKLY_BOSS_STAT_POINTS,
    })).digest('hex');
}

function legacyPayoutFingerprint(payout: WeeklyBossPayout): string {
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        playerName: payout.playerName.toLowerCase(),
        weekKey: payout.weekKey,
        aiId: payout.aiId,
        ryo: payout.ryo,
        gotCore: payout.gotCore,
        gotKey: payout.gotKey,
        statPoints: WEEKLY_BOSS_STAT_POINTS,
    })).digest('hex');
}

function legacyReceiptIdentity(payout: WeeklyBossPayout): { requestId: string; fingerprint: string; value: Record<string, unknown> } {
    return {
        requestId: `weeklyboss_${createHash('sha256').update(`${payout.weekKey}:${payout.playerName}`).digest('hex').slice(0, 32)}`,
        fingerprint: `weekly-boss:${payout.weekKey}:${payout.aiId}`,
        value: {
            weekKey: payout.weekKey,
            ryo: payout.ryo,
            gotCore: payout.gotCore,
            gotKey: payout.gotKey,
        },
    };
}

function markers(character: Record<string, unknown>): WeeklyBossPayoutMarker[] | null {
    const raw = character[WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const parsed: WeeklyBossPayoutMarker[] = [];
    const instances = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const value = entry as Partial<WeeklyBossPayoutMarker>;
        const ryo = safeAmount(value.ryo);
        const bossStartedAt = value.version === 2 ? safeAmount(value.bossStartedAt) : undefined;
        const instanceKey = value.version === 2
            ? `${value.weekKey}:${bossStartedAt}`
            : `legacy:${value.weekKey}`;
        if ((value.version !== 1 && value.version !== 2)
            || typeof value.weekKey !== 'string' || !/^\d{4}-W\d{2}$/.test(value.weekKey)
            || instances.has(instanceKey)
            || (value.version === 2 && (bossStartedAt === null || bossStartedAt === undefined || bossStartedAt <= 0))
            || typeof value.aiId !== 'string' || !value.aiId || value.aiId.length > 160
            || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
            || ryo === null
            || typeof value.gotCore !== 'boolean'
            || typeof value.gotKey !== 'boolean'
            || !Number.isFinite(Number(value.creditedAt)) || Number(value.creditedAt) <= 0
            || !Number.isFinite(Number(value.recoverUntil)) || Number(value.recoverUntil) <= Number(value.creditedAt)
            || (value.bossAcknowledgedAt !== undefined
                && (!Number.isFinite(Number(value.bossAcknowledgedAt)) || Number(value.bossAcknowledgedAt) <= 0))) return null;
        instances.add(instanceKey);
        parsed.push({
            version: value.version,
            weekKey: value.weekKey,
            ...(value.version === 2 ? { bossStartedAt: bossStartedAt as number } : {}),
            aiId: value.aiId,
            fingerprint: value.fingerprint,
            ryo,
            gotCore: value.gotCore,
            gotKey: value.gotKey,
            creditedAt: Number(value.creditedAt),
            recoverUntil: Number(value.recoverUntil),
            ...(value.bossAcknowledgedAt !== undefined ? { bossAcknowledgedAt: Number(value.bossAcknowledgedAt) } : {}),
        });
    }
    return parsed;
}

function appendMarker(
    existing: WeeklyBossPayoutMarker[],
    marker: WeeklyBossPayoutMarker,
): WeeklyBossPayoutMarker[] | null {
    const sameInstance = (entry: WeeklyBossPayoutMarker) => entry.weekKey === marker.weekKey
        && (entry.version === 1 || marker.version === 1 || entry.bossStartedAt === marker.bossStartedAt);
    const pending = existing.filter((entry) => !sameInstance(entry) && !entry.bossAcknowledgedAt);
    if (pending.length >= WEEKLY_BOSS_PAYOUT_ACTIVE_HARD_LIMIT) return null;
    const acknowledged = existing.filter((entry) => !sameInstance(entry) && !!entry.bossAcknowledgedAt);
    return [marker, ...pending, ...acknowledged.slice(0, Math.max(0, WEEKLY_BOSS_PAYOUT_SETTLEMENT_LIMIT - 1 - pending.length))];
}

/** Pure payout application retained for focused economy tests. */
export function applyWeeklyBossPayout(
    character: Record<string, unknown>,
    payout: WeeklyBossPayout,
): Record<string, unknown> {
    const inventory = Array.isArray(character.inventory) ? [...(character.inventory as string[])] : [];
    if (payout.gotCore) inventory.push(WEEKLY_BOSS_CORE_ID);
    if (payout.gotKey) inventory.push(DUNGEON_KEY_ID);
    const leveled = applyDerivedLevel({
        ...character,
        unspentStats: Math.max(0, Math.floor(Number(character.unspentStats) || 0)) + WEEKLY_BOSS_STAT_POINTS,
    } as unknown as XpCharacter) as unknown as Record<string, unknown>;
    return {
        ...character,
        unspentStats: leveled.unspentStats,
        level: leveled.level,
        maxHp: leveled.maxHp,
        maxChakra: leveled.maxChakra,
        maxStamina: leveled.maxStamina,
        hp: leveled.hp,
        chakra: leveled.chakra,
        stamina: leveled.stamina,
        rankTitle: leveled.rankTitle,
        ryo: Math.max(0, Number(character.ryo ?? 0)) + payout.ryo,
        inventory,
        weeklyBossKills: {
            ...(character.weeklyBossKills && typeof character.weeklyBossKills === 'object'
                ? character.weeklyBossKills as Record<string, unknown>
                : {}),
            [payout.weekKey]: payout.aiId,
        },
    };
}

/**
 * Credit a contributor and the non-evicting payout marker in one player-save
 * CAS. During a rolling deploy the legacy generic receipt is dual-written for
 * old workers, while an exact old receipt (or its server-owned weekly kill
 * stamp) is migrated without paying again.
 */
export async function creditWeeklyBossPayout(
    payout: WeeklyBossPayout,
    deps: {
        mutateSave?: typeof mutatePlayerSave;
        now?: () => number;
        recoverUntil?: number;
        /** Reconciliation may create a marker only from exact old proof; it
         * must never turn a boss-side acknowledgement into a fresh payout. */
        migrationOnly?: boolean;
    } = {},
): Promise<WeeklyBossPayoutCreditResult> {
    if (safeAmount(payout.bossStartedAt) === null || payout.bossStartedAt <= 0) {
        return { ok: false, status: 409, error: 'The Weekly Boss payout spawn identity is invalid.' };
    }
    const now = deps.now?.() ?? Date.now();
    const expectedFingerprint = payoutFingerprint(payout);
    const legacy = legacyReceiptIdentity(payout);
    const result: PlayerSaveMutationResult<{ replayed: boolean; migratedLegacy: boolean; creditedAt: number }> = await (deps.mutateSave ?? mutatePlayerSave)(
        payout.playerName,
        ({ character }) => {
            const existing = markers(character);
            if (!existing) return { ok: false as const, status: 409, error: 'The Weekly Boss payout authority is invalid.' };
            const exactPrior = existing.find((entry) => entry.version === 2
                && entry.weekKey === payout.weekKey
                && entry.bossStartedAt === payout.bossStartedAt);
            const legacyPrior = existing.find((entry) => entry.version === 1 && entry.weekKey === payout.weekKey);
            const otherSameWeek = existing.find((entry) => entry.weekKey === payout.weekKey
                && entry !== exactPrior && entry !== legacyPrior);
            if (otherSameWeek) {
                return { ok: false as const, status: 409, error: 'The Weekly Boss payout conflicts with another spawn in this week.' };
            }
            const prior = exactPrior ?? legacyPrior;
            if (prior) {
                const priorFingerprint = prior.version === 2 ? expectedFingerprint : legacyPayoutFingerprint(payout);
                if (prior.fingerprint !== priorFingerprint) {
                    return { ok: false as const, status: 409, error: 'The Weekly Boss payout authority conflicts with this week.' };
                }
                if (prior.version === 1) {
                    const migrated: WeeklyBossPayoutMarker = {
                        ...prior,
                        version: 2,
                        bossStartedAt: payout.bossStartedAt,
                        fingerprint: expectedFingerprint,
                    };
                    const nextMarkers = appendMarker(existing, migrated);
                    if (!nextMarkers) return { ok: false as const, status: 429, error: 'Too many Weekly Boss payouts are awaiting acknowledgement.' };
                    return {
                        ok: true as const,
                        character: { ...character, [WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD]: nextMarkers },
                        value: { replayed: true, migratedLegacy: true, creditedAt: prior.creditedAt },
                    };
                }
                return {
                    ok: true as const,
                    character,
                    value: { replayed: true, migratedLegacy: false, creditedAt: prior.creditedAt },
                    write: false as const,
                };
            }

            const inspected = inspectSettlementReceipt(character, legacy.requestId, legacy.fingerprint);
            if (inspected.status === 'invalid' || inspected.status === 'conflict') {
                return { ok: false as const, status: 409, error: 'The legacy Weekly Boss payout proof is invalid.' };
            }
            const kills = character.weeklyBossKills && typeof character.weeklyBossKills === 'object' && !Array.isArray(character.weeklyBossKills)
                ? character.weeklyBossKills as Record<string, unknown>
                : {};
            const priorKill = kills[payout.weekKey];
            if (priorKill !== undefined && priorKill !== payout.aiId) {
                return { ok: false as const, status: 409, error: 'The Weekly Boss payout conflicts with this week\'s prior boss.' };
            }
            const exactLegacyReceipt = inspected.status === 'replay' && isDeepStrictEqual(inspected.receipt.value, legacy.value);
            if (inspected.status === 'replay' && !exactLegacyReceipt) {
                return { ok: false as const, status: 409, error: 'The legacy Weekly Boss payout proof does not match this reward.' };
            }
            const migratedLegacy = exactLegacyReceipt || priorKill === payout.aiId;
            if (deps.migrationOnly && !migratedLegacy) {
                return { ok: false as const, status: 409, error: 'The Weekly Boss payout has no exact save-side proof to migrate.' };
            }
            const creditedAt = exactLegacyReceipt ? inspected.receipt.settledAt : now;
            const marker: WeeklyBossPayoutMarker = {
                version: 2,
                weekKey: payout.weekKey,
                bossStartedAt: payout.bossStartedAt,
                aiId: payout.aiId,
                fingerprint: expectedFingerprint,
                ryo: payout.ryo,
                gotCore: payout.gotCore,
                gotKey: payout.gotKey,
                creditedAt,
                recoverUntil: Math.max(
                    creditedAt + 1,
                    Math.floor(Number(deps.recoverUntil) || 0),
                    now + WEEKLY_BOSS_PAYOUT_RECOVERY_MS,
                ),
            };
            const nextMarkers = appendMarker(existing, marker);
            if (!nextMarkers) return { ok: false as const, status: 429, error: 'Too many Weekly Boss payouts are awaiting acknowledgement.' };
            const paid = migratedLegacy ? character : applyWeeklyBossPayout(character, payout);
            const dualWritten = inspected.status === 'fresh'
                ? appendSettlementReceipt(paid, inspected.receipts, {
                    requestId: legacy.requestId,
                    fingerprint: legacy.fingerprint,
                    value: legacy.value,
                    settledAt: now,
                })
                : paid;
            return {
                ok: true as const,
                character: {
                    ...dualWritten,
                    [WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD]: nextMarkers,
                },
                value: { replayed: migratedLegacy, migratedLegacy, creditedAt },
            };
        },
    );
    return result.ok
        ? { ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion }
        : result;
}

/** Mark the player marker acknowledged only after the boss-row CAS is proven. */
export async function acknowledgeWeeklyBossPayout(
    payout: WeeklyBossPayout,
    deps: { mutateSave?: typeof mutatePlayerSave; now?: () => number } = {},
): Promise<WeeklyBossPayoutAckResult> {
    if (safeAmount(payout.bossStartedAt) === null || payout.bossStartedAt <= 0) {
        return { ok: false, status: 409, error: 'The Weekly Boss payout spawn identity is invalid.' };
    }
    const now = deps.now?.() ?? Date.now();
    const expectedFingerprint = payoutFingerprint(payout);
    const result = await (deps.mutateSave ?? mutatePlayerSave)<{ replayed: boolean; acknowledgedAt: number }>(
        payout.playerName,
        ({ character }) => {
            const existing = markers(character);
            if (!existing) return { ok: false as const, status: 409, error: 'The Weekly Boss payout authority is invalid.' };
            const prior = existing.find((entry) => entry.version === 2
                && entry.weekKey === payout.weekKey
                && entry.bossStartedAt === payout.bossStartedAt);
            if (!prior || prior.fingerprint !== expectedFingerprint) {
                return { ok: false as const, status: 409, error: 'The Weekly Boss payout marker is unavailable.' };
            }
            if (prior.bossAcknowledgedAt) {
                return {
                    ok: true as const,
                    character,
                    value: { replayed: true, acknowledgedAt: prior.bossAcknowledgedAt },
                    write: false as const,
                };
            }
            const acknowledged: WeeklyBossPayoutMarker = { ...prior, bossAcknowledgedAt: now };
            const nextMarkers = appendMarker(existing, acknowledged);
            if (!nextMarkers) {
                return { ok: false as const, status: 429, error: 'Too many Weekly Boss payouts are awaiting acknowledgement.' };
            }
            return {
                ok: true as const,
                character: {
                    ...character,
                    [WEEKLY_BOSS_PAYOUT_SETTLEMENTS_FIELD]: nextMarkers,
                },
                value: { replayed: false, acknowledgedAt: now },
            };
        },
    );
    return result.ok
        ? { ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion }
        : result;
}
