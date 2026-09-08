import { useEffect } from "react";
import type { Character } from "../types/character";
import type { RefObject } from "react";
import type { CapabilityAvailability } from "./live-capabilities";
import type { usePlayerSaveState } from "./use-player-save-state";
import type { usePlayerSaveCoordinator } from "./use-player-save-coordinator";
import { useCapabilityGuardedAutosave } from "./use-capability-guarded-autosave";
import { capabilityAdmissionAllowed } from "./live-capability-admission";
import { protectSaveOnUnload } from "./save-unload";
import { SAVE_VERSION_EVENT, type SaveVersionEventDetail } from "../authFetch";
import { refreshPlayerSaveSnapshot, trackPlayerSectorChange, trackPlayerMissionChange, type SectorSaveGuard } from "./player-save-tracking";

type Coordinator = ReturnType<typeof usePlayerSaveCoordinator>;

/** Keep dirty tracking before the existing debounce, interval and flush clocks. */
export function usePlayerSaveLifecycle({ character, currentAccountName, fields, coordinator, sectorGuard,
    gameplayMutationsOpen, missionBattleActive, isPresenceBattleActive, mutationAvailability,
}: {
    character: Character | null; currentAccountName: string;
    fields: ReturnType<typeof usePlayerSaveState>; coordinator: Coordinator; sectorGuard: SectorSaveGuard;
    gameplayMutationsOpen: boolean; missionBattleActive: boolean;
    isPresenceBattleActive: () => boolean; mutationAvailability: () => CapabilityAvailability;
}) {
    const { currentSector, pendingTravel, acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, activeTraining, activeJutsuTraining, lastSnapshotMissionSigRef } = fields;
    const { charDirtyRef, flushSaveRef, latestSaveRef, saveSoonTimerRef, persistSave } = coordinator;
    const { lastSnapshotAppliedSectorRef, lastLocalSectorChangeRef } = sectorGuard;
    useEffect(() => { refreshPlayerSaveSnapshot(character, currentAccountName, fields, coordinator); });
    useEffect(() => { trackPlayerSectorChange(character, currentAccountName, currentSector, { charDirtyRef }, { lastSnapshotAppliedSectorRef, lastLocalSectorChangeRef }); },
        [currentSector, character, currentAccountName, charDirtyRef, lastSnapshotAppliedSectorRef, lastLocalSectorChangeRef]);
    useEffect(() => { trackPlayerMissionChange(character, currentAccountName, { acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel, lastSnapshotMissionSigRef }, { charDirtyRef, flushSaveRef }); },
        [acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel, character, currentAccountName, lastSnapshotMissionSigRef, charDirtyRef, flushSaveRef]);
    useCapabilityGuardedAutosave({
        enabled: gameplayMutationsOpen,
        debounceTriggers: { character, accountName: currentAccountName, sector: currentSector, pendingTravel, missionBattleActive },
        intervalPresenceActive: isPresenceBattleActive(),
        immediateTriggers: { activeTraining, activeJutsuTraining, hospitalized: Boolean(character?.hospitalized), pendingTravel, missionProgress, missionBattleActive },
        debounceTimerRef: saveSoonTimerRef, dirtyRef: charDirtyRef, flushRef: flushSaveRef,
        latestSnapshotRef: latestSaveRef, mutationAvailability, isPresenceBattleActive, persistSave,
    });
}

export function usePlayerSaveVersionEvents(acceptExternalSaveVersion: Coordinator["saveAuthority"]["acceptExternalVersion"]): void {
    useEffect(() => {
        const onSaveVersion = (event: Event) => {
            const detail = (event as CustomEvent<Partial<SaveVersionEventDetail>>).detail, version = Number(detail?.version);
            if (!Number.isFinite(version) || version <= 0) return;
            if (detail.source !== "full-save" && typeof detail.accountName === "string") acceptExternalSaveVersion(version, detail.accountName);
        };
        window.addEventListener(SAVE_VERSION_EVENT, onSaveVersion); return () => window.removeEventListener(SAVE_VERSION_EVENT, onSaveVersion);
    }, [acceptExternalSaveVersion]);
}

export function usePlayerSaveConflictExpiry({ saveConflictDraft, rehydrateSaveConflictDraft }: Pick<Coordinator, "saveConflictDraft" | "rehydrateSaveConflictDraft">): void {
    useEffect(() => {
        if (!saveConflictDraft) return;
        const nextExpiry = Math.min(...saveConflictDraft.revisions.map((revision) => revision.expiresAt));
        const timer = window.setTimeout(
            () => { void rehydrateSaveConflictDraft(saveConflictDraft.accountName); },
            Math.max(0, nextExpiry - Date.now() + 50),
        );
        return () => window.clearTimeout(timer);
    }, [saveConflictDraft, rehydrateSaveConflictDraft]);
}

    // Save on page unload (F5 / tab close / navigation away) so that progress
    // made since the last auto-save is not lost.
    // keepalive: true tells the browser to complete the fetch even after the
    // page has been torn down. Auth headers are injected automatically by the
    // global authFetch interceptor (window.fetch is patched at app boot and
    // spreads all RequestInit properties — including keepalive — to the real fetch).
    // The 64 KB keepalive body limit is protected by stripping embedded image
    // data before serialising.
export function usePlayerSaveUnload(coordinator: Coordinator, saveSessionEpochRef: RefObject<number>, mutationAvailability: () => CapabilityAvailability): void {
    const { activeSaveAccountKey, charDirtyRef, saveFlightRef, latestSaveVersionRef, savePersistenceRef, latestSaveRef, captureSaveConflictDraft, discardSaveConflictRevision } = coordinator;
    const isCurrentSaveSession = coordinator.saveAuthority.isCurrent;
    useEffect(() => {
        function handleBeforeUnload() {
            const unloadAccountKey = activeSaveAccountKey();
            const unloadSessionEpoch = saveSessionEpochRef.current;
            protectSaveOnUnload({ dirty: charDirtyRef.current, flightBusy: saveFlightRef.current.busy(),
                accountKey: unloadAccountKey, sessionEpoch: unloadSessionEpoch, latestVersion: latestSaveVersionRef.current,
                unresolved: savePersistenceRef.current?.getUnresolvedPost() ?? null, liveSnapshot: latestSaveRef.current,
                captureConflict: captureSaveConflictDraft, discardRevision: discardSaveConflictRevision,
                isCurrentSession: isCurrentSaveSession,
                send: capabilityAdmissionAllowed(mutationAvailability()) });
        }
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [mutationAvailability, activeSaveAccountKey, charDirtyRef, saveFlightRef, latestSaveVersionRef, savePersistenceRef, latestSaveRef, captureSaveConflictDraft, discardSaveConflictRevision, isCurrentSaveSession, saveSessionEpochRef]);
}
