// P0-2: durable outbox for won-combat-mission claims.
//
// The Arena win → /api/missions/queue-combat-claim handoff used to be
// fire-and-retry-4-times: if every attempt failed (~6s offline) the local
// pendingCombatMissionClaims flag was the only record, and the next
// 409-refetch snapshot replace discarded it — the win was simply lost and the
// player had to re-fight (Phase 0 reward-settlement audit, the one open
// mission-claim race). The queue endpoint is idempotent (re-posting an
// already-queued mission refreshes its token), so the safe fix is durability:
// park un-acked wins in localStorage and re-post until the server answers.
//
// Entries leave the outbox when the server ACKS (queued, or a definitive
// queued:false decision) or when they age out. Network failures keep the entry.

import { useEffect } from 'react';
import { queueCombatMissionClaim } from './mission-combat-claim';

export type ClaimOutboxStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY_PREFIX = 'combatClaimOutbox.v1:';
// Legacy E/D queueing needs no live combat session, so an offline win can
// settle whenever the player is next online — but not unboundedly late, or a
// stale entry could re-surface a long-dead mission card. Two days is far past
// any legitimate "played offline, reconnected later" horizon.
export const CLAIM_OUTBOX_MAX_AGE_MS = 48 * 60 * 60 * 1000;

type OutboxEntry = { missionId: string; addedAt: number };

const storageKey = (player: string) => `${KEY_PREFIX}${player.toLowerCase()}`;

function defaultStorage(): ClaimOutboxStorage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

export function readClaimOutbox(player: string, storage: ClaimOutboxStorage | null = defaultStorage()): OutboxEntry[] {
    if (!storage || !player) return [];
    try {
        const raw = storage.getItem(storageKey(player));
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return parsed
            .filter((e): e is OutboxEntry => !!e && typeof e === 'object'
                && typeof (e as OutboxEntry).missionId === 'string'
                && Number.isFinite((e as OutboxEntry).addedAt))
            .filter((e) => now - e.addedAt <= CLAIM_OUTBOX_MAX_AGE_MS);
    } catch {
        return [];
    }
}

function writeClaimOutbox(player: string, entries: OutboxEntry[], storage: ClaimOutboxStorage | null): void {
    if (!storage || !player) return;
    try {
        if (entries.length === 0) storage.removeItem(storageKey(player));
        else storage.setItem(storageKey(player), JSON.stringify(entries.slice(-20)));
    } catch { /* quota/privacy-mode — the in-flight attempt still runs */ }
}

/** Park a won mission until the server acks its queue call. Deduped. */
export function enqueueClaim(player: string, missionId: string, storage: ClaimOutboxStorage | null = defaultStorage()): void {
    if (!player || !missionId) return;
    const entries = readClaimOutbox(player, storage);
    if (entries.some((e) => e.missionId === missionId)) return;
    writeClaimOutbox(player, [...entries, { missionId, addedAt: Date.now() }], storage);
}

export function removeClaim(player: string, missionId: string, storage: ClaimOutboxStorage | null = defaultStorage()): void {
    if (!player) return;
    writeClaimOutbox(player, readClaimOutbox(player, storage).filter((e) => e.missionId !== missionId), storage);
}

let flushInFlight = false;

/**
 * Re-post every parked win. Success (or any definitive server decision — the
 * endpoint returns 200 with queued:false reasons) removes the entry; a
 * network/5xx failure keeps it for the next flush. Returns the newest
 * `_saveVersion` seen so the caller can advance its optimistic-concurrency
 * base, or undefined when nothing advanced.
 */
export async function flushClaimOutbox(
    player: string,
    storage: ClaimOutboxStorage | null = defaultStorage(),
    queue: typeof queueCombatMissionClaim = queueCombatMissionClaim,
): Promise<number | undefined> {
    if (!player || flushInFlight) return undefined;
    const entries = readClaimOutbox(player, storage);
    if (entries.length === 0) return undefined;
    flushInFlight = true;
    let latestVersion: number | undefined;
    try {
        for (const entry of entries) {
            const result = await queue(player, entry.missionId, 2);
            if (result) {
                removeClaim(player, entry.missionId, storage);
                if (typeof result.saveVersion === 'number') latestVersion = result.saveVersion;
            }
            // null = transient failure — keep the entry for the next flush.
        }
    } finally {
        flushInFlight = false;
    }
    return latestVersion;
}

/**
 * Drain the outbox on login and whenever the browser reconnects.
 *
 * Lives here rather than in App.tsx so the retry policy sits next to the queue
 * it drains (and so App.tsx keeps shrinking). `onSaveVersion` receives the
 * newest `_saveVersion` the server returned, so the caller can advance its
 * optimistic-concurrency base without this module knowing about save state.
 */
export function useClaimOutboxDrain(playerName: string | undefined, onSaveVersion: (version: number) => void): void {
    useEffect(() => {
        if (!playerName) return;
        const drain = () => void flushClaimOutbox(playerName).then((version) => {
            if (typeof version === 'number') onSaveVersion(version);
        });
        drain();
        window.addEventListener('online', drain);
        return () => window.removeEventListener('online', drain);
        // onSaveVersion is a stable ref-setter at the call site; keying on the
        // player alone keeps a re-render from re-registering the listener.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playerName]);
}
