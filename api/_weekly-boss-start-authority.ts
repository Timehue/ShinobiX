import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { appendSettlementReceipt, inspectSettlementReceipt } from './_settlement-receipts.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from './save/_mutate-player-save.js';

export const WEEKLY_BOSS_START_SETTLEMENTS_FIELD = 'weeklyBossStartSettlements';
export const WEEKLY_BOSS_START_SETTLEMENT_LIMIT = 64;

export type WeeklyBossStartSeal = {
    runId: string;
    playerName: string;
    weekKey: string;
    aiId: string;
    bossStartedAt: number;
    createdAt: number;
    recoverUntil: number;
};

type WeeklyBossStartMarker = {
    runId: string;
    fingerprint: string;
    chargedAt: number;
    recoverUntil: number;
    readyAt?: number;
};

export type WeeklyBossStartChargeResult =
    | { ok: true; replayed: boolean; chargedAt: number; character: Record<string, unknown>; _saveVersion: number }
    | { ok: false; status: number; error: string };

export type WeeklyBossStartFinalizeResult =
    | { ok: true; replayed: boolean; readyAt: number; character: Record<string, unknown>; _saveVersion: number }
    | { ok: false; status: number; error: string };

function fingerprint(seal: WeeklyBossStartSeal): string {
    return createHash('sha256').update(JSON.stringify({
        version: 1,
        runId: seal.runId,
        playerName: seal.playerName.toLowerCase(),
        weekKey: seal.weekKey,
        aiId: seal.aiId,
        bossStartedAt: seal.bossStartedAt,
        createdAt: seal.createdAt,
    })).digest('hex');
}

function legacyStartReceipt(seal: WeeklyBossStartSeal): {
    requestId: string;
    fingerprint: string;
    value: Record<string, unknown>;
} {
    return {
        requestId: `weekly-start-${seal.runId}`,
        fingerprint: `${seal.weekKey}:${seal.aiId}:${seal.bossStartedAt}`,
        value: { kind: 'weekly-boss-start', stamina: 20 },
    };
}

function markers(character: Record<string, unknown>): WeeklyBossStartMarker[] | null {
    const raw = character[WEEKLY_BOSS_START_SETTLEMENTS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const parsed: WeeklyBossStartMarker[] = [];
    const runIds = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const value = entry as Partial<WeeklyBossStartMarker>;
        if (typeof value.runId !== 'string' || !/^[A-Za-z0-9:_-]{1,96}$/.test(value.runId)
            || runIds.has(value.runId)
            || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
            || !Number.isFinite(Number(value.chargedAt)) || Number(value.chargedAt) <= 0
            || !Number.isFinite(Number(value.recoverUntil)) || Number(value.recoverUntil) < 0
            || (value.readyAt !== undefined && (!Number.isFinite(Number(value.readyAt)) || Number(value.readyAt) <= 0))) return null;
        runIds.add(value.runId);
        parsed.push({
            runId: value.runId,
            fingerprint: value.fingerprint,
            chargedAt: Number(value.chargedAt),
            recoverUntil: Number(value.recoverUntil),
            ...(value.readyAt !== undefined ? { readyAt: Number(value.readyAt) } : {}),
        });
    }
    return parsed;
}

function compactWithPending(
    existing: WeeklyBossStartMarker[],
    marker: WeeklyBossStartMarker,
    now: number,
): WeeklyBossStartMarker[] {
    const protectedPending = existing.filter((entry) => (
        entry.runId !== marker.runId && !entry.readyAt && entry.recoverUntil > now
    ));
    const ordinary = existing.filter((entry) => (
        entry.runId !== marker.runId
        && !protectedPending.some((pending) => pending.runId === entry.runId)
    ));
    return [
        marker,
        ...protectedPending,
        ...ordinary.slice(0, Math.max(0, WEEKLY_BOSS_START_SETTLEMENT_LIMIT - 1 - protectedPending.length)),
    ];
}

export async function chargeWeeklyBossStart(
    seal: WeeklyBossStartSeal,
    deps: { mutateSave?: typeof mutatePlayerSave; now?: () => number } = {},
): Promise<WeeklyBossStartChargeResult> {
    const now = deps.now?.() ?? Date.now();
    const expectedFingerprint = fingerprint(seal);
    const legacy = legacyStartReceipt(seal);
    const result: PlayerSaveMutationResult<{ replayed: boolean; chargedAt: number }> = await (deps.mutateSave ?? mutatePlayerSave)<{ replayed: boolean; chargedAt: number }>(
        seal.playerName,
        ({ character }) => {
            const existing = markers(character);
            if (!existing) return { ok: false as const, status: 409, error: 'The Weekly Boss start authority is invalid.' };
            const prior = existing.find((entry) => entry.runId === seal.runId);
            if (prior && prior.fingerprint !== expectedFingerprint) {
                return { ok: false as const, status: 409, error: 'The Weekly Boss start authority conflicts with this run.' };
            }
            if (prior) {
                const legacyProof = inspectSettlementReceipt(character, legacy.requestId, legacy.fingerprint);
                if (legacyProof.status === 'invalid' || legacyProof.status === 'conflict'
                    || (legacyProof.status === 'replay' && !isDeepStrictEqual(legacyProof.receipt.value, legacy.value))) {
                    return { ok: false as const, status: 409, error: 'The legacy Weekly Boss stamina proof conflicts with this run.' };
                }
                if (legacyProof.status === 'fresh') {
                    return {
                        ok: true as const,
                        character: appendSettlementReceipt(character, legacyProof.receipts, {
                            requestId: legacy.requestId,
                            fingerprint: legacy.fingerprint,
                            value: legacy.value,
                            settledAt: prior.chargedAt,
                        }),
                        value: { replayed: true, chargedAt: prior.chargedAt },
                    };
                }
                return {
                    ok: true as const,
                    character,
                    value: { replayed: true, chargedAt: prior.chargedAt },
                    write: false as const,
                };
            }
            const legacyProof = inspectSettlementReceipt(character, legacy.requestId, legacy.fingerprint);
            if (legacyProof.status === 'invalid' || legacyProof.status === 'conflict') {
                return { ok: false as const, status: 409, error: 'The legacy Weekly Boss stamina proof conflicts with this run.' };
            }
            if (legacyProof.status === 'replay') {
                if (!isDeepStrictEqual(legacyProof.receipt.value, legacy.value)) {
                    return { ok: false as const, status: 409, error: 'The legacy Weekly Boss stamina proof does not match this run.' };
                }
                const migrated: WeeklyBossStartMarker = {
                    runId: seal.runId,
                    fingerprint: expectedFingerprint,
                    chargedAt: legacyProof.receipt.settledAt,
                    recoverUntil: Math.max(now, Math.floor(Number(seal.recoverUntil) || now)),
                };
                return {
                    ok: true as const,
                    character: {
                        ...character,
                        [WEEKLY_BOSS_START_SETTLEMENTS_FIELD]: compactWithPending(existing, migrated, now),
                    },
                    value: { replayed: true, chargedAt: migrated.chargedAt },
                };
            }
            if (Number(character.stamina ?? 0) < 20) {
                return { ok: false as const, status: 409, error: 'Stamina changed before the fight could start.' };
            }
            const marker: WeeklyBossStartMarker = {
                runId: seal.runId,
                fingerprint: expectedFingerprint,
                chargedAt: now,
                recoverUntil: Math.max(now, Math.floor(Number(seal.recoverUntil) || now)),
            };
            const charged = appendSettlementReceipt({
                ...character,
                stamina: Number(character.stamina ?? 0) - 20,
            }, legacyProof.receipts, {
                requestId: legacy.requestId,
                fingerprint: legacy.fingerprint,
                value: legacy.value,
                settledAt: now,
            });
            return {
                ok: true as const,
                character: {
                    ...charged,
                    [WEEKLY_BOSS_START_SETTLEMENTS_FIELD]: compactWithPending(existing, marker, now),
                },
                value: { replayed: false, chargedAt: now },
            };
        },
    );
    return result.ok
        ? { ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion }
        : result;
}

export async function finalizeWeeklyBossStart(
    seal: WeeklyBossStartSeal,
    deps: { mutateSave?: typeof mutatePlayerSave; now?: () => number } = {},
): Promise<WeeklyBossStartFinalizeResult> {
    const now = deps.now?.() ?? Date.now();
    const expectedFingerprint = fingerprint(seal);
    const legacy = legacyStartReceipt(seal);
    const result: PlayerSaveMutationResult<{ replayed: boolean; readyAt: number }> = await (deps.mutateSave ?? mutatePlayerSave)<{ replayed: boolean; readyAt: number }>(
        seal.playerName,
        ({ character }) => {
            const existing = markers(character);
            if (!existing) return { ok: false as const, status: 409, error: 'The Weekly Boss start authority is invalid.' };
            let prior = existing.find((entry) => entry.runId === seal.runId);
            if (prior && prior.fingerprint !== expectedFingerprint) {
                return { ok: false as const, status: 409, error: 'The Weekly Boss stamina charge is unavailable.' };
            }
            const legacyProof = inspectSettlementReceipt(character, legacy.requestId, legacy.fingerprint);
            if (legacyProof.status === 'invalid' || legacyProof.status === 'conflict'
                || (legacyProof.status === 'replay' && !isDeepStrictEqual(legacyProof.receipt.value, legacy.value))) {
                return { ok: false as const, status: 409, error: 'The legacy Weekly Boss stamina proof conflicts with this run.' };
            }
            // A ready run created by the pre-cutover worker has only the exact
            // generic receipt. Promote it in-place; never debit again.
            if (!prior) {
                if (legacyProof.status !== 'replay') {
                    return { ok: false as const, status: 409, error: 'The Weekly Boss stamina charge is unavailable.' };
                }
                prior = {
                    runId: seal.runId,
                    fingerprint: expectedFingerprint,
                    chargedAt: legacyProof.receipt.settledAt,
                    recoverUntil: Math.max(now, Math.floor(Number(seal.recoverUntil) || now)),
                };
            }
            if (prior.readyAt) {
                if (legacyProof.status === 'fresh') {
                    return {
                        ok: true as const,
                        character: appendSettlementReceipt(character, legacyProof.receipts, {
                            requestId: legacy.requestId,
                            fingerprint: legacy.fingerprint,
                            value: legacy.value,
                            settledAt: prior.chargedAt,
                        }),
                        value: { replayed: true, readyAt: prior.readyAt },
                    };
                }
                return {
                    ok: true as const,
                    character,
                    value: { replayed: true, readyAt: prior.readyAt },
                    write: false as const,
                };
            }
            const ready: WeeklyBossStartMarker = { ...prior, recoverUntil: 0, readyAt: now };
            const withLegacy = legacyProof.status === 'fresh'
                ? appendSettlementReceipt(character, legacyProof.receipts, {
                    requestId: legacy.requestId,
                    fingerprint: legacy.fingerprint,
                    value: legacy.value,
                    settledAt: prior.chargedAt,
                })
                : character;
            return {
                ok: true as const,
                character: {
                    ...withLegacy,
                    [WEEKLY_BOSS_START_SETTLEMENTS_FIELD]: compactWithPending(existing, ready, now),
                },
                value: { replayed: false, readyAt: now },
            };
        },
    );
    return result.ok
        ? { ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion }
        : result;
}
