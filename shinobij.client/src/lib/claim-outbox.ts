// P0-2: durable outbox for won-combat-mission claims.
//
// The sealed mission win → /api/missions/queue-combat-claim handoff used to be
// fire-and-retry-4-times: if every attempt failed (~6s offline) the local
// pendingCombatMissionClaims flag was the only record, and the next
// 409-refetch snapshot replace discarded it — the win was simply lost and the
// player had to re-fight (Phase 0 reward-settlement audit, the one open
// mission-claim race). Each v2 entry retains the exact server-minted runId, so
// retries can prove the completed encounter instead of promoting local state.
//
// Entries leave the outbox when the server ACKS (queued, or a definitive
// queued:false decision) or when they age out. Network failures keep the entry.

import { useEffect, useRef } from 'react';
import {
    isAuthoritativeCombatMissionCharacter,
    queueCombatMissionClaim,
    type CombatMissionQueueResult,
} from './mission-combat-claim';
import type { Character } from '../types/character';

export type ClaimOutboxStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY_PREFIX = 'combatClaimOutbox.v2:';
const LEGACY_KEY_PREFIX = 'combatClaimOutbox.v1:';
// The start binding is authoritative for 45 minutes. Keeping a client retry
// beyond that window cannot recover a payout and risks resurfacing dead UI.
export const CLAIM_OUTBOX_MAX_AGE_MS = 45 * 60 * 1000;

export type CombatClaimOutboxEntry = { missionId: string; runId: string; addedAt: number };

const storageKey = (player: string) => `${KEY_PREFIX}${player.toLowerCase()}`;

function defaultStorage(): ClaimOutboxStorage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

export function readClaimOutbox(player: string, storage: ClaimOutboxStorage | null = defaultStorage()): CombatClaimOutboxEntry[] {
    if (!storage || !player) return [];
    try {
        // v1 stored only missionId. There is no safe way to infer which server
        // run won, so quarantine it instead of sending an authority-less retry.
        storage.removeItem(`${LEGACY_KEY_PREFIX}${player.toLowerCase()}`);
        const raw = storage.getItem(storageKey(player));
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        const seenRuns = new Set<string>();
        const entries = parsed
            .filter((e): e is CombatClaimOutboxEntry => !!e && typeof e === 'object'
                && typeof (e as CombatClaimOutboxEntry).missionId === 'string'
                && (e as CombatClaimOutboxEntry).missionId.length > 0
                && (e as CombatClaimOutboxEntry).missionId.length <= 80
                && typeof (e as CombatClaimOutboxEntry).runId === 'string'
                && (e as CombatClaimOutboxEntry).runId.length > 0
                && (e as CombatClaimOutboxEntry).runId.length <= 96
                && Number.isFinite((e as CombatClaimOutboxEntry).addedAt)
                && (e as CombatClaimOutboxEntry).addedAt > 0
                && (e as CombatClaimOutboxEntry).addedAt <= now + 5 * 60 * 1000
                && now - (e as CombatClaimOutboxEntry).addedAt <= CLAIM_OUTBOX_MAX_AGE_MS)
            .filter((entry) => {
                if (seenRuns.has(entry.runId)) return false;
                seenRuns.add(entry.runId);
                return true;
            })
            .map(({ missionId, runId, addedAt }) => ({ missionId, runId, addedAt }))
            .slice(-20);
        // Prune corrupt/expired/unbounded storage immediately; otherwise an
        // empty flush leaves a dead key behind forever.
        if (JSON.stringify(entries) !== JSON.stringify(parsed)) {
            if (entries.length === 0) storage.removeItem(storageKey(player));
            else storage.setItem(storageKey(player), JSON.stringify(entries));
        }
        return entries;
    } catch {
        return [];
    }
}

function writeClaimOutbox(player: string, entries: CombatClaimOutboxEntry[], storage: ClaimOutboxStorage | null): void {
    if (!storage || !player) return;
    try {
        if (entries.length === 0) storage.removeItem(storageKey(player));
        else storage.setItem(storageKey(player), JSON.stringify(entries.slice(-20)));
    } catch { /* quota/privacy-mode — the in-flight attempt still runs */ }
}

/** Park a won mission until the server acks its queue call. Deduped. */
export function enqueueClaim(player: string, missionId: string, runId: string, storage: ClaimOutboxStorage | null = defaultStorage()): void {
    if (!player || !missionId || !runId) return;
    const entries = readClaimOutbox(player, storage);
    if (entries.some((e) => e.runId === runId)) return;
    writeClaimOutbox(player, [...entries, { missionId, runId, addedAt: Date.now() }], storage);
}

export function removeClaim(player: string, missionId: string, runId: string, storage: ClaimOutboxStorage | null = defaultStorage()): void {
    if (!player) return;
    writeClaimOutbox(player, readClaimOutbox(player, storage).filter((e) => (
        e.missionId !== missionId || e.runId !== runId
    )), storage);
}

export type ClaimOutboxDrainResult = {
    playerName: string;
    character: Character;
    saveVersion: number;
};

const flushInFlight = new Map<string, Promise<ClaimOutboxDrainResult | undefined>>();

/**
 * Re-post every parked win. Success (or any definitive server decision — the
 * endpoint returns 200 with queued:false reasons) removes the entry; a
 * retryable result keeps it for the next flush. Returns the newest validated
 * authoritative character + `_saveVersion`, or undefined when nothing advanced.
 */
export async function flushClaimOutbox(
    player: string,
    storage: ClaimOutboxStorage | null = defaultStorage(),
    queue: typeof queueCombatMissionClaim = queueCombatMissionClaim,
): Promise<ClaimOutboxDrainResult | undefined> {
    if (!player) return undefined;
    const playerKey = player.toLowerCase();
    const existing = flushInFlight.get(playerKey);
    if (existing) return existing;
    const entries = readClaimOutbox(player, storage);
    if (entries.length === 0) return undefined;
    const flight = (async () => {
        let latest: ClaimOutboxDrainResult | undefined;
        for (const entry of entries) {
            let result: CombatMissionQueueResult;
            try {
                result = await queue(player, entry.missionId, entry.runId, 2);
            } catch {
                continue;
            }
            if (result.disposition === 'retryable') continue;
            if (result.disposition === 'accepted') {
                if (!isAuthoritativeCombatMissionCharacter(result.character)
                    || typeof result.saveVersion !== 'number'
                    || result.character.name.toLowerCase() !== playerKey) continue;
                removeClaim(player, entry.missionId, entry.runId, storage);
                if (!latest || result.saveVersion >= latest.saveVersion) {
                    latest = {
                        playerName: player,
                        character: result.character,
                        saveVersion: result.saveVersion,
                    };
                }
            } else {
                removeClaim(player, entry.missionId, entry.runId, storage);
            }
        }
        return latest;
    })();
    flushInFlight.set(playerKey, flight);
    try {
        return await flight;
    } finally {
        if (flushInFlight.get(playerKey) === flight) flushInFlight.delete(playerKey);
    }
}

/**
 * Drain the outbox on login and whenever the browser reconnects.
 *
 * Lives here rather than in App.tsx so the retry policy sits next to the queue
 * it drains (and so App.tsx keeps shrinking). The callback receives a validated
 * same-account server snapshot and version; generation checks suppress a late
 * completion after logout or account switching.
 */
export function useClaimOutboxDrain(
    playerName: string | undefined,
    onAuthoritativeSave: (snapshot: ClaimOutboxDrainResult) => void,
): void {
    const callbackRef = useRef(onAuthoritativeSave);
    useEffect(() => { callbackRef.current = onAuthoritativeSave; }, [onAuthoritativeSave]);
    const generationRef = useRef(0);
    useEffect(() => {
        if (!playerName) return;
        const expectedPlayer = playerName.toLowerCase();
        const generation = ++generationRef.current;
        let active = true;
        const drain = () => void flushClaimOutbox(playerName).then((snapshot) => {
            if (!snapshot || !active || generationRef.current !== generation
                || snapshot.playerName.toLowerCase() !== expectedPlayer
                || snapshot.character.name.toLowerCase() !== expectedPlayer) return;
            callbackRef.current(snapshot);
        });
        drain();
        window.addEventListener('online', drain);
        return () => {
            active = false;
            generationRef.current += 1;
            window.removeEventListener('online', drain);
        };
    }, [playerName]);
}
