import type { KvLike } from '../_storage.js';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { sealCompanionFromSave, type CompanionSeal } from '../combat-core/companion.js';
import {
    mutatePlayerSave,
    type PlayerSaveMutationResult,
} from '../save/_mutate-player-save.js';
import { applyCompanionUsageCost } from './_settlement.js';
import type { SoloPveSession } from './_session.js';
import { soloPveCompanionUsageReceiptIdentity } from './_usage-receipts.js';

const SUMMON_LEASE_PREFIX = 'solo-pve-summon:';
const SUMMON_LEASE_TTL_SECONDS = 2 * 60 * 60;
export const SOLO_PVE_COMPANION_SETTLEMENTS_FIELD = 'soloPveCompanionSettlements';
export const SOLO_PVE_COMPANION_SETTLEMENT_LIMIT = 32;

type LeaseStore = Pick<KvLike, 'get' | 'set' | 'delIfEqual'>;
type MutateSave = typeof mutatePlayerSave;

type CompanionSettlementMarker = {
    sessionId: string;
    fingerprint: string;
    chargedAt: number;
    recoverUntil: number;
    committedAt?: number;
};

function companionSettlementMarkers(character: Record<string, unknown>): CompanionSettlementMarker[] | null {
    const raw = character[SOLO_PVE_COMPANION_SETTLEMENTS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const markers: CompanionSettlementMarker[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const marker = entry as Partial<CompanionSettlementMarker>;
        if (typeof marker.sessionId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(marker.sessionId)
            || typeof marker.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(marker.fingerprint)
            || !Number.isFinite(Number(marker.chargedAt)) || Number(marker.chargedAt) <= 0
            || !Number.isFinite(Number(marker.recoverUntil)) || Number(marker.recoverUntil) < 0
            || (marker.committedAt !== undefined && (!Number.isFinite(Number(marker.committedAt)) || Number(marker.committedAt) <= 0))) return null;
        markers.push({
            sessionId: marker.sessionId,
            fingerprint: marker.fingerprint,
            chargedAt: Number(marker.chargedAt),
            recoverUntil: Number(marker.recoverUntil),
            ...(marker.committedAt !== undefined ? { committedAt: Number(marker.committedAt) } : {}),
        });
    }
    return markers;
}

function compactCompanionMarkers(
    existing: CompanionSettlementMarker[],
    marker: CompanionSettlementMarker,
    now: number,
): CompanionSettlementMarker[] {
    const protectedPending = existing.filter((entry) => (
        entry.sessionId !== marker.sessionId && !entry.committedAt && entry.recoverUntil > now
    ));
    const ordinary = existing.filter((entry) => (
        entry.sessionId !== marker.sessionId
        && !protectedPending.some((pending) => pending.sessionId === entry.sessionId)
    ));
    return [
        marker,
        ...protectedPending,
        ...ordinary.slice(0, Math.max(0, SOLO_PVE_COMPANION_SETTLEMENT_LIMIT - 1 - protectedPending.length)),
    ];
}

export type SoloPveSummonLease = {
    key: string;
    value: string;
    resumed: boolean;
};

export type SoloPveSummonClaim =
    | { ok: true; companion: CompanionSeal; lease: SoloPveSummonLease }
    | { ok: false; status: number; error: string };

export type SoloPveCompanionChargeResult =
    | { ok: true; chargedAt: number; replayed: boolean; character: Record<string, unknown>; _saveVersion: number }
    | { ok: false; status: number; error: string };
export type SoloPveCompanionFinalizeResult =
    | { ok: true; committedAt: number; replayed: boolean }
    | { ok: false; status: number; error: string };

export function soloPveSummonLeaseKey(playerName: string): string {
    const player = safeName(playerName);
    if (!player) throw new Error('invalid-solo-pve-summon-player');
    return `pet:battle-active:${player}`;
}

export function soloPveSummonLeaseValue(sessionId: string, moveToken?: string): string {
    const value = String(sessionId ?? '').trim();
    if (!value || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) {
        throw new Error('invalid-solo-pve-summon-session');
    }
    if (moveToken !== undefined && !/^[A-Za-z0-9_-]{8,96}$/.test(moveToken)) {
        throw new Error('invalid-solo-pve-summon-move');
    }
    return `${SUMMON_LEASE_PREFIX}${value}${moveToken ? `:${moveToken}` : ''}`;
}

function validSummonLeaseValue(session: SoloPveSession, leaseValue: string): boolean {
    const moveToken = session.companionCostAuthority?.moveToken;
    return leaseValue === soloPveSummonLeaseValue(session.sessionId)
        || (!!moveToken && leaseValue === soloPveSummonLeaseValue(session.sessionId, moveToken));
}

async function ensureSummonLeaseValue(
    store: LeaseStore,
    playerName: string,
    leaseValue: string,
): Promise<boolean> {
    const key = soloPveSummonLeaseKey(playerName);
    if (await store.get<string>(key).catch(() => null) === leaseValue) return true;
    try {
        if (await store.set(key, leaseValue, { nx: true, ex: SUMMON_LEASE_TTL_SECONDS }) === 'OK') return true;
    } catch (error) {
        if (await store.get<string>(key).catch(() => null) === leaseValue) return true;
        throw error;
    }
    return await store.get<string>(key).catch(() => null) === leaseValue;
}

/**
 * Claim the common pet-combat boundary. Exact readback handles a lost NX
 * acknowledgement and also resumes a crash that landed the lease immediately
 * before the session write.
 */
export async function claimSoloPveSummonLease(
    store: LeaseStore,
    playerName: string,
    sessionId: string,
    moveToken?: string,
): Promise<SoloPveSummonLease | null> {
    const key = soloPveSummonLeaseKey(playerName);
    const value = soloPveSummonLeaseValue(sessionId, moveToken);
    try {
        if (await store.set(key, value, { nx: true, ex: SUMMON_LEASE_TTL_SECONDS }) === 'OK') {
            return { key, value, resumed: false };
        }
    } catch (error) {
        if (await store.get<string>(key).catch(() => null) !== value) throw error;
        return { key, value, resumed: true };
    }
    return await store.get<string>(key).catch(() => null) === value
        ? { key, value, resumed: true }
        : null;
}

/** Compare-delete only this summon; never erase a successor battle. */
export async function releaseSoloPveSummonLeaseValue(
    store: LeaseStore,
    playerName: string,
    leaseValue: string,
): Promise<boolean> {
    const key = soloPveSummonLeaseKey(playerName);
    const value = String(leaseValue ?? '').trim();
    if (!value.startsWith(SUMMON_LEASE_PREFIX)
        || value.length <= SUMMON_LEASE_PREFIX.length
        || value.length > SUMMON_LEASE_PREFIX.length + 128 + 1 + 96
        || !/^[A-Za-z0-9:_-]+$/.test(value.slice(SUMMON_LEASE_PREFIX.length))) {
        throw new Error('invalid-solo-pve-summon-lease');
    }
    try {
        if (await store.delIfEqual(key, value)) return true;
    } catch (error) {
        // A lost delete acknowledgement is success when exact readback proves
        // this sentinel is gone. If it remains, surface the failure so the
        // caller retains its pending recovery state.
        if (await store.get<string>(key).catch(() => value) === value) throw error;
        return true;
    }
    return await store.get<string>(key).catch(() => value) !== value;
}

/** Compare-delete a lease derived by this worker. */
export async function releaseSoloPveSummonLease(
    store: LeaseStore,
    playerName: string,
    sessionId: string,
    moveToken?: string,
): Promise<boolean> {
    return releaseSoloPveSummonLeaseValue(
        store,
        playerName,
        soloPveSummonLeaseValue(sessionId, moveToken),
    );
}

/** Claim first, then re-seal the current entitled active pet from the save. */
export async function claimAuthoritativeSoloPveCompanion(
    session: SoloPveSession,
    now = Date.now(),
    deps: {
        store?: LeaseStore;
        readSave?: (playerName: string) => Promise<Record<string, unknown> | null>;
        moveToken?: string;
    } = {},
): Promise<SoloPveSummonClaim> {
    const store = deps.store ?? kv;
    const moveToken = deps.moveToken;
    const lease = await claimSoloPveSummonLease(store, session.ownerSlug, session.sessionId, moveToken);
    if (!lease) {
        return { ok: false, status: 409, error: 'Finish or settle your active pet battle first.' };
    }
    try {
        const record = deps.readSave
            ? await deps.readSave(session.ownerSlug)
            : await kv.get<Record<string, unknown>>(`save:${safeName(session.ownerSlug)}`);
        const character = record?.character as Record<string, unknown> | undefined;
        const companion = character ? sealCompanionFromSave(character, now) : null;
        if (!character || !companion) {
            await releaseSoloPveSummonLease(store, session.ownerSlug, session.sessionId, moveToken);
            return {
                ok: false,
                status: character ? 409 : 404,
                error: character ? 'No eligible active companion can be summoned.' : 'Player save not found.',
            };
        }
        return { ok: true, companion, lease };
    } catch (error) {
        await releaseSoloPveSummonLease(store, session.ownerSlug, session.sessionId, moveToken).catch(() => false);
        throw error;
    }
}

/**
 * Charge the server-sealed summoned pet exactly once. The save receipt and the
 * decrement share one versioned save write; a replay never decrements again.
 */
export async function settleSoloPveCompanionUsage(
    session: SoloPveSession,
    deps: { store?: LeaseStore; mutateSave?: MutateSave; now?: () => number } = {},
): Promise<SoloPveCompanionChargeResult> {
    const authority = session.companionCostAuthority;
    const usage = session.companionUsage;
    if (!authority || !usage || authority.version !== 1
        || !validSummonLeaseValue(session, authority.leaseValue)) {
        return { ok: false, status: 409, error: 'The companion summon has no valid cost authority.' };
    }
    const store = deps.store ?? kv;
    const mutateSave = deps.mutateSave ?? mutatePlayerSave;
    const now = deps.now?.() ?? Date.now();
    const identity = soloPveCompanionUsageReceiptIdentity(session);
    const result: PlayerSaveMutationResult<{ chargedAt: number; replayed: boolean }> = await mutateSave<{ chargedAt: number; replayed: boolean }>(
        session.ownerSlug,
        async ({ character }) => {
            const markers = companionSettlementMarkers(character);
            if (!markers) {
                return { ok: false as const, status: 409, error: 'The companion usage receipt is invalid or conflicts with this summon.' };
            }
            const existing = markers.find((marker) => marker.sessionId === session.sessionId);
            if (existing && existing.fingerprint !== identity.fingerprint) {
                return { ok: false as const, status: 409, error: 'The companion usage receipt is invalid or conflicts with this summon.' };
            }
            if (existing) {
                return {
                    ok: true as const,
                    character,
                    value: { chargedAt: existing.chargedAt, replayed: true },
                    write: false as const,
                };
            }
            // The session row is durable ownership of this exact move-specific
            // lease. If the TTL elapsed after its CAS, safely reacquire only
            // when no successor battle owns the shared pet boundary.
            if (!(await ensureSummonLeaseValue(store, session.ownerSlug, authority.leaseValue))) {
                return { ok: false as const, status: 409, error: 'The companion summon is no longer exclusively reserved.' };
            }
            const charged = applyCompanionUsageCost(character, usage);
            const marker: CompanionSettlementMarker = {
                sessionId: session.sessionId,
                fingerprint: identity.fingerprint,
                chargedAt: now,
                recoverUntil: Math.max(now, Math.floor(Number(session.expiresAt) || now)),
            };
            return {
                ok: true as const,
                character: {
                    ...charged,
                    [SOLO_PVE_COMPANION_SETTLEMENTS_FIELD]: compactCompanionMarkers(markers, marker, now),
                },
                value: { chargedAt: now, replayed: false },
            };
        },
    );
    return result.ok
        ? {
            ok: true,
            chargedAt: result.value.chargedAt,
            replayed: result.value.replayed,
            character: result.character,
            _saveVersion: result._saveVersion,
        }
        : result;
}

export async function finalizeSoloPveCompanionUsage(
    session: SoloPveSession,
    deps: { mutateSave?: MutateSave; now?: () => number } = {},
): Promise<SoloPveCompanionFinalizeResult> {
    const identity = soloPveCompanionUsageReceiptIdentity(session);
    const now = deps.now?.() ?? Date.now();
    const result = await (deps.mutateSave ?? mutatePlayerSave)<{ committedAt: number; replayed: boolean }>(
        session.ownerSlug,
        ({ character }) => {
            const markers = companionSettlementMarkers(character);
            if (!markers) return { ok: false as const, status: 409, error: 'The companion usage manifest is invalid.' };
            const existing = markers.find((marker) => marker.sessionId === session.sessionId);
            if (!existing || existing.fingerprint !== identity.fingerprint) {
                return { ok: false as const, status: 409, error: 'The companion charge marker is unavailable.' };
            }
            if (existing.committedAt) {
                return {
                    ok: true as const,
                    character,
                    value: { committedAt: existing.committedAt, replayed: true },
                    write: false as const,
                };
            }
            const committed: CompanionSettlementMarker = { ...existing, recoverUntil: 0, committedAt: now };
            return {
                ok: true as const,
                character: {
                    ...character,
                    [SOLO_PVE_COMPANION_SETTLEMENTS_FIELD]: compactCompanionMarkers(markers, committed, now),
                },
                value: { committedAt: now, replayed: false },
            };
        },
    );
    return result.ok
        ? { ok: true, committedAt: result.value.committedAt, replayed: result.value.replayed }
        : result;
}
