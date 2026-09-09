import type { Character } from "../types/character";
import type { RefObject } from "react";
import type { usePlayerSaveState } from "./use-player-save-state";
import type { createPlayerSaveCoordinator } from "./player-save-coordinator";
import { isIdleVitalsOnlyChange } from "./loaded-vitals";
import { nextSavePayloadRevision } from "./save-flight";

type SaveState = ReturnType<typeof usePlayerSaveState>;
type Coordinator = ReturnType<typeof createPlayerSaveCoordinator>;
export type SectorSaveGuard = { lastSnapshotAppliedSectorRef: RefObject<number | null>; lastLocalSectorChangeRef: RefObject<number> };

/** Publish this render's snapshot without creating a write or dirtying idle regen. */
// Dirty-tracking: only auto-save when character state actually changed locally.
// This prevents a second device (e.g. desktop) from continuously re-uploading the
// snapshot it loaded from the server, which would overwrite progress made on the
// primary device (e.g. mobile still in the village).
//
// How it works: we compare character object references (React immutable pattern).
// Refs only change when setCharacter() is called with new data. After a server load
// we seed prevCharRef so the load itself isn't counted as a local change.
// Signature of the last snapshot-applied mission/biome state — lets the
// standalone-state dirty effect tell a local change from a snapshot reapply.
export function refreshPlayerSaveSnapshot(character: Character | null, currentAccountName: string, fields: SaveState,
    coordinator: Pick<Coordinator, "latestSaveRef" | "savePayloadIdentityRef" | "prevCharRef" | "charDirtyRef" | "savePayloadRevisionRef">): void {
    const {
        currentBiome,
        activeTraining,
        activeJutsuTraining,
        acceptedMissionIds,
        missionProgress,
        triggeredEvents,
        currentSector,
        pendingTravel,
        savedBloodlines,
        creatorJutsus,
        creatorAis,
        creatorEvents,
        creatorMissions,
        creatorRaids,
        creatorCards,
        creatorItems,
        petEncounterVn,
        ancientChestVn,
        editablePets,
        hollowGateEventConfig,
        buildPlayerSavePayload,
    } = fields;
    const { latestSaveRef, savePayloadIdentityRef, prevCharRef, charDirtyRef, savePayloadRevisionRef } = coordinator;

    if (!character || !currentAccountName) {
        latestSaveRef.current = null;
        savePayloadIdentityRef.current = null;
        return;
    }
    // Detect genuine local character changes (reference inequality = new React state).
    if (character !== prevCharRef.current) {
        // ⛔ A pure idle-regen tick must NOT dirty the save, or a merely-open tab autosaves forever: lib/loaded-vitals.ts isIdleVitalsOnlyChange.
        if (!isIdleVitalsOnlyChange(prevCharRef.current, character)) charDirtyRef.current = true;
        prevCharRef.current = character;
    }
    const payloadIdentity: readonly unknown[] = [
        character,
        currentBiome,
        activeTraining,
        activeJutsuTraining,
        acceptedMissionIds,
        missionProgress,
        triggeredEvents,
        currentSector,
        pendingTravel,
        savedBloodlines,
        creatorJutsus,
        creatorAis,
        creatorEvents,
        creatorMissions,
        creatorRaids,
        creatorCards,
        creatorItems,
        petEncounterVn,
        ancientChestVn,
        editablePets,
        hollowGateEventConfig,
    ];
    const previousIdentity = savePayloadIdentityRef.current;
    if (!previousIdentity
        || previousIdentity.length !== payloadIdentity.length
        || payloadIdentity.some((value, index) => !Object.is(value, previousIdentity[index]))) {
        savePayloadRevisionRef.current = nextSavePayloadRevision(savePayloadRevisionRef.current);
        savePayloadIdentityRef.current = payloadIdentity;
    }
    latestSaveRef.current = {
        character,
        name: currentAccountName,
        payload: buildPlayerSavePayload(character),
        revision: savePayloadRevisionRef.current,
    };

}

// Mark the save dirty when sector changes locally. Without this the
// 15s/3s autosave only fires on character-reference changes, so a fresh
// sector wasn't persisted promptly — a 409 refetch returned the server's
// stale value and the player visibly rubber-banded to the previous sector.
// Snapshot-driven changes are tagged via lastSnapshotAppliedSectorRef so
// they don't falsely flip charDirtyRef.

export function trackPlayerSectorChange(character: Character | null, currentAccountName: string, currentSector: number, coordinator: Pick<Coordinator, "charDirtyRef">, guard: SectorSaveGuard): void {
    const { charDirtyRef } = coordinator;
    const { lastSnapshotAppliedSectorRef, lastLocalSectorChangeRef } = guard;

    if (!character || !currentAccountName) return;
    if (lastSnapshotAppliedSectorRef.current === currentSector) {
        lastSnapshotAppliedSectorRef.current = null;
        return;
    }
    charDirtyRef.current = true;
    lastLocalSectorChangeRef.current = Date.now();

}

// Mark the save dirty when standalone top-level state (acceptedMissionIds /
// missionProgress / triggeredEvents / currentBiome) changes locally — these
// are in buildPlayerSavePayload but touch neither the character ref nor
// currentSector, so the autosave timers never scheduled a save (accept a
// contract then close the tab → lost it). The signature guard skips changes a
// server snapshot just reapplied so a load doesn't falsely flip dirty.
export function trackPlayerMissionChange(character: Character | null, currentAccountName: string,
    fields: Pick<SaveState, "acceptedMissionIds" | "missionProgress" | "triggeredEvents" | "currentBiome" | "pendingTravel" | "lastSnapshotMissionSigRef">,
    coordinator: Pick<Coordinator, "charDirtyRef" | "flushSaveRef">): void {
    const { acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel, lastSnapshotMissionSigRef } = fields;
    const { charDirtyRef, flushSaveRef } = coordinator;

    if (!character || !currentAccountName) return;
    const sig = JSON.stringify([acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel]);
    if (lastSnapshotMissionSigRef.current === sig) { lastSnapshotMissionSigRef.current = null; return; }
    charDirtyRef.current = true;
    if (pendingTravel) flushSaveRef.current = true;

}
