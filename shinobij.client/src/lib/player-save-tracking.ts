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
        // Idle vitals already do not dirty the save. They must not invalidate
        // an in-flight acknowledgement either: otherwise every slow logout save
        // finishes behind the next regen tick and can never clear its dirty flag.
        const onlyIdleRegen = previousIdentity?.length === payloadIdentity.length
            && isIdleVitalsOnlyChange(previousIdentity[0], character)
            && payloadIdentity.every((value, index) => index === 0 || Object.is(value, previousIdentity[index]));
        if (!onlyIdleRegen) savePayloadRevisionRef.current = nextSavePayloadRevision(savePayloadRevisionRef.current);
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

//
// `lastTracked` (optional): the account and sector this tracker last acted on.
// The lifecycle effect also re-runs on every `character` change, including each
// one-second idle-regen tick. Without it every tick re-dirtied the save, which
// defeated the idle-regen guard in refreshPlayerSaveSnapshot: a player
// regenerating after a fight POSTed a full save every ~3s for up to 30 minutes.
// With it, only a real sector (or account) change marks the save dirty.
export function trackPlayerSectorChange(character: Character | null, currentAccountName: string, currentSector: number, coordinator: Pick<Coordinator, "charDirtyRef">, guard: SectorSaveGuard, lastTracked?: { current: string | null }): void {
    const { charDirtyRef } = coordinator;
    const { lastSnapshotAppliedSectorRef, lastLocalSectorChangeRef } = guard;

    if (!character || !currentAccountName) return;
    const trackedKey = `${currentAccountName}\u0000${currentSector}`;
    if (lastSnapshotAppliedSectorRef.current === currentSector) {
        lastSnapshotAppliedSectorRef.current = null;
        if (lastTracked) lastTracked.current = trackedKey;
        return;
    }
    if (lastTracked) {
        if (lastTracked.current === trackedKey) return;
        lastTracked.current = trackedKey;
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
// `lastTracked` (optional) works as in trackPlayerSectorChange: an idle-regen
// re-run with the same mission/travel state no longer dirties (or, during a
// journey, force-flushes) the save on every tick.
export function trackPlayerMissionChange(character: Character | null, currentAccountName: string,
    fields: Pick<SaveState, "acceptedMissionIds" | "missionProgress" | "triggeredEvents" | "currentBiome" | "pendingTravel" | "lastSnapshotMissionSigRef">,
    coordinator: Pick<Coordinator, "charDirtyRef" | "flushSaveRef">, lastTracked?: { current: string | null }): void {
    const { acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel, lastSnapshotMissionSigRef } = fields;
    const { charDirtyRef, flushSaveRef } = coordinator;

    if (!character || !currentAccountName) return;
    const sig = JSON.stringify([acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel]);
    const trackedKey = `${currentAccountName}\u0000${sig}`;
    if (lastSnapshotMissionSigRef.current === sig) {
        lastSnapshotMissionSigRef.current = null;
        if (lastTracked) lastTracked.current = trackedKey;
        return;
    }
    if (lastTracked) {
        if (lastTracked.current === trackedKey) return;
        lastTracked.current = trackedKey;
    }
    charDirtyRef.current = true;
    if (pendingTravel) flushSaveRef.current = true;

}
