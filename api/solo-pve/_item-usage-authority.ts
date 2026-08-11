import type { KvLike } from '../_storage.js';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { deductUsedItems } from '../pvp/claim-rewards.js';
import type { SoloPveItemCostAuthority, SoloPveSession } from './_session.js';
import { soloPveItemActionReceiptIdentity } from './_usage-receipts.js';

const ITEM_LEASE_PREFIX = 'solo-pve-item:';
const ITEM_LEASE_TTL_SECONDS = 2 * 60 * 60;
export const SOLO_PVE_ITEM_SETTLEMENTS_FIELD = 'soloPveItemSettlements';
export const SOLO_PVE_ITEM_SETTLEMENT_LIMIT = 128;

type LeaseStore = Pick<KvLike, 'get' | 'set' | 'delIfEqual'>;
type ItemSettlementMarker = {
    markerId: string;
    fingerprint: string;
    chargedAt: number;
    recoverUntil: number;
    committedAt?: number;
};

export type SoloPveItemActionLease = { key: string; value: string; resumed: boolean };
export type SoloPveItemChargeResult =
    | { ok: true; chargedAt: number; replayed: boolean; character: Record<string, unknown>; _saveVersion: number }
    | { ok: false; status: number; error: string };
export type SoloPveItemFinalizeResult =
    | { ok: true; committedAt: number; replayed: boolean }
    | { ok: false; status: number; error: string };

function itemMarkers(character: Record<string, unknown>): ItemSettlementMarker[] | null {
    const raw = character[SOLO_PVE_ITEM_SETTLEMENTS_FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const markers: ItemSettlementMarker[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const marker = entry as Partial<ItemSettlementMarker>;
        if (typeof marker.markerId !== 'string' || marker.markerId.length < 10 || marker.markerId.length > 240
            || typeof marker.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(marker.fingerprint)
            || !Number.isFinite(Number(marker.chargedAt)) || Number(marker.chargedAt) <= 0
            || !Number.isFinite(Number(marker.recoverUntil)) || Number(marker.recoverUntil) < 0
            || (marker.committedAt !== undefined && (!Number.isFinite(Number(marker.committedAt)) || Number(marker.committedAt) <= 0))) return null;
        markers.push({
            markerId: marker.markerId,
            fingerprint: marker.fingerprint,
            chargedAt: Number(marker.chargedAt),
            recoverUntil: Number(marker.recoverUntil),
            ...(marker.committedAt !== undefined ? { committedAt: Number(marker.committedAt) } : {}),
        });
    }
    return markers;
}

function compactItemMarkers(
    existing: ItemSettlementMarker[],
    marker: ItemSettlementMarker,
    now: number,
): ItemSettlementMarker[] {
    const protectedPending = existing.filter((entry) => (
        entry.markerId !== marker.markerId && !entry.committedAt && entry.recoverUntil > now
    ));
    const ordinary = existing.filter((entry) => (
        entry.markerId !== marker.markerId
        && !protectedPending.some((pending) => pending.markerId === entry.markerId)
    ));
    return [
        marker,
        ...protectedPending,
        ...ordinary.slice(0, Math.max(0, SOLO_PVE_ITEM_SETTLEMENT_LIMIT - 1 - protectedPending.length)),
    ];
}

function ownedItemCount(character: Record<string, unknown>, itemId: string): number {
    let count = Array.isArray(character.inventory)
        ? (character.inventory as unknown[]).filter((entry) => entry === itemId).length
        : 0;
    if (Array.isArray(character.itemStacks)) {
        for (const stack of character.itemStacks as Array<Record<string, unknown>>) {
            if (stack?.itemId === itemId) count += Math.max(0, Math.floor(Number(stack.count) || 0));
        }
    }
    return count;
}

export function soloPveItemActionLeaseKey(playerName: string): string {
    const player = safeName(playerName);
    if (!player) throw new Error('invalid-solo-pve-item-player');
    return `solo-pve:item-active:${player}`;
}

export function soloPveItemActionLeaseValue(sessionId: string, moveToken: string): string {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(sessionId)
        || !/^[A-Za-z0-9_-]{8,96}$/.test(moveToken)) throw new Error('invalid-solo-pve-item-action');
    return `${ITEM_LEASE_PREFIX}${sessionId}:${moveToken}`;
}

export async function claimSoloPveItemActionLease(
    store: LeaseStore,
    playerName: string,
    sessionId: string,
    moveToken: string,
): Promise<SoloPveItemActionLease | null> {
    const key = soloPveItemActionLeaseKey(playerName);
    const value = soloPveItemActionLeaseValue(sessionId, moveToken);
    try {
        if (await store.set(key, value, { nx: true, ex: ITEM_LEASE_TTL_SECONDS }) === 'OK') {
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

export async function releaseSoloPveItemActionLease(
    store: LeaseStore,
    playerName: string,
    sessionId: string,
    moveToken: string,
): Promise<boolean> {
    const key = soloPveItemActionLeaseKey(playerName);
    const value = soloPveItemActionLeaseValue(sessionId, moveToken);
    try {
        if (await store.delIfEqual(key, value)) return true;
    } catch (error) {
        if (await store.get<string>(key).catch(() => value) === value) throw error;
        return true;
    }
    return await store.get<string>(key).catch(() => value) !== value;
}

export function soloPveItemCostAuthority(params: {
    session: SoloPveSession;
    moveToken: string;
    itemId: string;
    count: number;
    leaseValue: string;
    chargedAt: number;
}): SoloPveItemCostAuthority {
    return {
        version: 1,
        leaseValue: params.leaseValue,
        moveToken: params.moveToken,
        itemId: params.itemId,
        count: Math.max(1, Math.floor(Number(params.count) || 1)),
        chargedAt: params.chargedAt,
    };
}

export async function settleSoloPveItemActionUsage(
    session: SoloPveSession,
    authority: Omit<SoloPveItemCostAuthority, 'chargedAt'>,
    deps: { store?: LeaseStore; mutateSave?: typeof mutatePlayerSave; now?: () => number } = {},
): Promise<SoloPveItemChargeResult> {
    const count = Math.max(1, Math.floor(Number(authority.count) || 1));
    if (authority.version !== 1 || !authority.itemId
        || authority.leaseValue !== soloPveItemActionLeaseValue(session.sessionId, authority.moveToken)) {
        return { ok: false, status: 409, error: 'The item action has no valid cost authority.' };
    }
    const store = deps.store ?? kv;
    const identity = soloPveItemActionReceiptIdentity({
        session,
        moveToken: authority.moveToken,
        itemId: authority.itemId,
        count,
    });
    const now = deps.now?.() ?? Date.now();
    const result: PlayerSaveMutationResult<{ chargedAt: number; replayed: boolean }> = await (deps.mutateSave ?? mutatePlayerSave)<{ chargedAt: number; replayed: boolean }>(
        session.ownerSlug,
        async ({ character }) => {
            const markers = itemMarkers(character);
            if (!markers) return { ok: false as const, status: 409, error: 'The item usage manifest is invalid.' };
            const existing = markers.find((marker) => marker.markerId === identity.markerId);
            if (existing && existing.fingerprint !== identity.fingerprint) {
                return { ok: false as const, status: 409, error: 'The item usage marker conflicts with this action.' };
            }
            if (existing) {
                return {
                    ok: true as const,
                    character,
                    value: { chargedAt: existing.chargedAt, replayed: true },
                    write: false as const,
                };
            }
            if (await store.get<string>(soloPveItemActionLeaseKey(session.ownerSlug)) !== authority.leaseValue) {
                return { ok: false as const, status: 409, error: 'The item action is no longer exclusively reserved.' };
            }
            if (ownedItemCount(character, authority.itemId) < count) {
                return { ok: false as const, status: 409, error: 'The combat item is no longer available.' };
            }
            const marker: ItemSettlementMarker = {
                markerId: identity.markerId,
                fingerprint: identity.fingerprint,
                chargedAt: now,
                recoverUntil: Math.max(now, Math.floor(Number(session.expiresAt) || now)),
            };
            // An uncommitted marker is the only proof available if the charge
            // lands but the session write does not. Preserve every still-live
            // recovery marker ahead of the soft history cap. The per-player
            // lease permits at most one such live marker in ordinary operation.
            return {
                ok: true as const,
                character: {
                    ...deductUsedItems(character, { [authority.itemId]: count }),
                    [SOLO_PVE_ITEM_SETTLEMENTS_FIELD]: compactItemMarkers(markers, marker, now),
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

/** Mark the charge recoverable from the now-durable session before releasing. */
export async function finalizeSoloPveItemActionUsage(
    session: SoloPveSession,
    authority: SoloPveItemCostAuthority,
    deps: { mutateSave?: typeof mutatePlayerSave; now?: () => number } = {},
): Promise<SoloPveItemFinalizeResult> {
    const identity = soloPveItemActionReceiptIdentity({
        session,
        moveToken: authority.moveToken,
        itemId: authority.itemId,
        count: authority.count,
    });
    const now = deps.now?.() ?? Date.now();
    const result = await (deps.mutateSave ?? mutatePlayerSave)<{ committedAt: number; replayed: boolean }>(
        session.ownerSlug,
        ({ character }) => {
            const markers = itemMarkers(character);
            if (!markers) return { ok: false as const, status: 409, error: 'The item usage manifest is invalid.' };
            const existing = markers.find((marker) => marker.markerId === identity.markerId);
            if (!existing || existing.fingerprint !== identity.fingerprint) {
                return { ok: false as const, status: 409, error: 'The item action charge marker is unavailable.' };
            }
            if (existing.committedAt) {
                return {
                    ok: true as const,
                    character,
                    value: { committedAt: existing.committedAt, replayed: true },
                    write: false as const,
                };
            }
            const committed: ItemSettlementMarker = { ...existing, recoverUntil: 0, committedAt: now };
            return {
                ok: true as const,
                character: {
                    ...character,
                    [SOLO_PVE_ITEM_SETTLEMENTS_FIELD]: compactItemMarkers(markers, committed, now),
                },
                value: { committedAt: now, replayed: false },
            };
        },
    );
    return result.ok
        ? { ok: true, committedAt: result.value.committedAt, replayed: result.value.replayed }
        : result;
}
