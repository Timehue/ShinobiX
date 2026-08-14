// Durable outbox for run-bound built-in combat mission wins.

import { useEffect, useRef } from "react";
import type { Character } from "../types/character";
import {
    isAuthoritativeCombatMissionCharacter,
    queueCombatMissionClaim,
    type CombatMissionQueueResult,
} from "./mission-combat-claim";

export type ClaimOutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "combatClaimOutbox.v2:";
const LEGACY_KEY_PREFIX = "combatClaimOutbox.v1:";
// The authoritative combat binding expires after 45 minutes.
export const CLAIM_OUTBOX_MAX_AGE_MS = 45 * 60 * 1000;

export type CombatClaimOutboxEntry = { missionId: string; runId: string; addedAt: number };

const storageKey = (player: string) => `${KEY_PREFIX}${player.toLowerCase()}`;

function defaultStorage(): ClaimOutboxStorage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export function readClaimOutbox(
    player: string,
    storage: ClaimOutboxStorage | null = defaultStorage(),
): CombatClaimOutboxEntry[] {
    if (!storage || !player) return [];
    try {
        // v1 had no run proof and is unsafe to replay.
        storage.removeItem(`${LEGACY_KEY_PREFIX}${player.toLowerCase()}`);
        const raw = storage.getItem(storageKey(player));
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        const seenRuns = new Set<string>();
        const entries = parsed
            .filter((entry): entry is CombatClaimOutboxEntry => !!entry && typeof entry === "object"
                && typeof (entry as CombatClaimOutboxEntry).missionId === "string"
                && (entry as CombatClaimOutboxEntry).missionId.length > 0
                && (entry as CombatClaimOutboxEntry).missionId.length <= 80
                && typeof (entry as CombatClaimOutboxEntry).runId === "string"
                && (entry as CombatClaimOutboxEntry).runId.length > 0
                && (entry as CombatClaimOutboxEntry).runId.length <= 96
                && Number.isFinite((entry as CombatClaimOutboxEntry).addedAt)
                && (entry as CombatClaimOutboxEntry).addedAt > 0
                && (entry as CombatClaimOutboxEntry).addedAt <= now + 5 * 60 * 1000
                && now - (entry as CombatClaimOutboxEntry).addedAt <= CLAIM_OUTBOX_MAX_AGE_MS)
            .filter((entry) => {
                if (seenRuns.has(entry.runId)) return false;
                seenRuns.add(entry.runId);
                return true;
            })
            .map(({ missionId, runId, addedAt }) => ({ missionId, runId, addedAt }))
            .slice(-20);
        if (JSON.stringify(entries) !== JSON.stringify(parsed)) {
            if (entries.length === 0) storage.removeItem(storageKey(player));
            else storage.setItem(storageKey(player), JSON.stringify(entries));
        }
        return entries;
    } catch {
        return [];
    }
}

function writeClaimOutbox(
    player: string,
    entries: CombatClaimOutboxEntry[],
    storage: ClaimOutboxStorage | null,
): void {
    if (!storage || !player) return;
    try {
        if (entries.length === 0) storage.removeItem(storageKey(player));
        else storage.setItem(storageKey(player), JSON.stringify(entries.slice(-20)));
    } catch { /* private mode: the in-flight request still runs */ }
}

export function enqueueClaim(
    player: string,
    missionId: string,
    runId: string,
    storage: ClaimOutboxStorage | null = defaultStorage(),
): void {
    if (!player || !missionId || !runId) return;
    const entries = readClaimOutbox(player, storage);
    if (entries.some((entry) => entry.runId === runId)) return;
    writeClaimOutbox(player, [...entries, { missionId, runId, addedAt: Date.now() }], storage);
}

export function removeClaim(
    player: string,
    missionId: string,
    runId: string,
    storage: ClaimOutboxStorage | null = defaultStorage(),
): void {
    if (!player) return;
    writeClaimOutbox(
        player,
        readClaimOutbox(player, storage).filter((entry) => entry.missionId !== missionId || entry.runId !== runId),
        storage,
    );
}

export type ClaimOutboxDrainResult = {
    playerName: string;
    character: Character;
    saveVersion: number;
};

const flushInFlight = new Map<string, Promise<ClaimOutboxDrainResult | undefined>>();

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
            if (result.disposition === "retryable") continue;
            if (result.disposition === "accepted") {
                if (!isAuthoritativeCombatMissionCharacter(result.character)
                    || typeof result.saveVersion !== "number"
                    || result.character.name.toLowerCase() !== playerKey) continue;
                removeClaim(player, entry.missionId, entry.runId, storage);
                if (!latest || result.saveVersion >= latest.saveVersion) {
                    latest = { playerName: player, character: result.character, saveVersion: result.saveVersion };
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
        window.addEventListener("online", drain);
        return () => {
            active = false;
            generationRef.current += 1;
            window.removeEventListener("online", drain);
        };
    }, [playerName]);
}
