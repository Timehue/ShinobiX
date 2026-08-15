import { useEffect, useEffectEvent } from "react";
import type { CapabilityAvailability } from "./live-capabilities";
import { capabilityAdmissionAllowed } from "./live-capability-admission";

type MutableBox<T> = { current: T };

type DebounceTriggers = Readonly<{
    character: unknown;
    accountName: string;
    sector: unknown;
    pendingTravel: unknown;
    missionBattleActive: boolean;
}>;

type ImmediateTriggers = Readonly<{
    activeTraining: unknown;
    activeJutsuTraining: unknown;
    hospitalized: boolean;
    pendingTravel: unknown;
    missionProgress: unknown;
    missionBattleActive: boolean;
}>;

/** Owns the three App-level autosave clocks while leaving snapshot creation and
 * persistence authority with App's existing save coordinator. Every delayed or
 * immediate write checks the live store at the last possible moment; a rejected
 * write keeps the dirty/flush latch armed for the next admitted cycle. */
export function useCapabilityGuardedAutosave<T>({
    enabled,
    debounceTriggers,
    intervalPresenceActive,
    immediateTriggers,
    debounceTimerRef,
    dirtyRef,
    flushRef,
    latestSnapshotRef,
    mutationAvailability,
    isPresenceBattleActive,
    persistSave,
}: {
    enabled: boolean;
    debounceTriggers: DebounceTriggers;
    intervalPresenceActive: boolean;
    immediateTriggers: ImmediateTriggers;
    debounceTimerRef: MutableBox<ReturnType<typeof setTimeout> | null>;
    dirtyRef: MutableBox<boolean>;
    flushRef: MutableBox<boolean>;
    latestSnapshotRef: MutableBox<T | null>;
    mutationAvailability: () => CapabilityAvailability;
    isPresenceBattleActive: () => boolean;
    persistSave: (snapshot: T) => unknown;
}) {
    const persistDirtySnapshot = useEffectEvent(() => {
        if (!capabilityAdmissionAllowed(mutationAvailability()) || !dirtyRef.current || isPresenceBattleActive()) return;
        const snapshot = latestSnapshotRef.current;
        if (!snapshot) return;
        dirtyRef.current = false;
        void persistSave(snapshot);
    });

    const flushDirtySnapshot = useEffectEvent(() => {
        if (!enabled || !capabilityAdmissionAllowed(mutationAvailability()) || isPresenceBattleActive()
            || (!flushRef.current && !(immediateTriggers.hospitalized && dirtyRef.current))) return;
        flushRef.current = false;
        if (!debounceTriggers.character || !debounceTriggers.accountName) return;
        const snapshot = latestSnapshotRef.current;
        if (!snapshot) return;
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        dirtyRef.current = false;
        void persistSave(snapshot);
    });

    useEffect(() => {
        if (!enabled || !debounceTriggers.character || !debounceTriggers.accountName || !dirtyRef.current || intervalPresenceActive) return;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            persistDirtySnapshot();
        }, 3000);
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [
        debounceTimerRef, debounceTriggers.accountName, debounceTriggers.character,
        debounceTriggers.missionBattleActive, debounceTriggers.pendingTravel,
        debounceTriggers.sector, dirtyRef, enabled, intervalPresenceActive, latestSnapshotRef,
    ]);

    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(persistDirtySnapshot, 15_000);
        return () => clearInterval(id);
    }, [dirtyRef, enabled, intervalPresenceActive, latestSnapshotRef]);

    useEffect(() => {
        flushDirtySnapshot();
    }, [
        debounceTriggers.accountName, debounceTriggers.character, enabled,
        immediateTriggers.activeJutsuTraining, immediateTriggers.activeTraining, immediateTriggers.hospitalized,
        immediateTriggers.missionBattleActive, immediateTriggers.missionProgress,
        immediateTriggers.pendingTravel,
    ]);
}
