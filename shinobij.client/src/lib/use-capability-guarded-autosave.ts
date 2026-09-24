import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CapabilityAvailability } from "./live-capabilities";
import { capabilityAdmissionAllowed } from "./live-capability-admission";
import { AUTOSAVE_RETRY } from "./save-persistence";

type MutableBox<T> = { current: T };

/** How soon a deferred immediate flush tries again (the blocking save is ≤ ~3s). */
const FLUSH_RETRY_MS = 1_000;
const FLUSH_RETRY_MAX_MS = 8_000;

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

    const [flushRetryTick, setFlushRetryTick] = useState(0);
    const flushRetryStreakRef = useRef(0);
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
        void Promise.resolve(persistSave(snapshot)).then((result) => {
            const outcome = result as { status?: unknown; value?: unknown } | null | undefined;
            if (outcome?.status !== "deferred" && outcome?.value !== AUTOSAVE_RETRY) {
                flushRetryStreakRef.current = 0;
                return;
            }
            // Another save held the flight (e.g. waiting out the server's save
            // window), or this one waited and then stood down because authority
            // moved. An immediate flush — travel, training start, a KO — must not
            // slide to the 15s interval: re-arm it and try again shortly.
            flushRef.current = true;
            flushRetryStreakRef.current += 1;
            setFlushRetryTick((tick) => tick + 1);
        });
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
        if (!flushRetryTick) return;
        // Back off (1s, 2s, 4s, 8s) so a long server wait — up to a minute after
        // the per-minute save cap — costs a handful of App re-renders, not one a second.
        const streak = Math.max(1, flushRetryStreakRef.current);
        const id = setTimeout(() => flushDirtySnapshot(), Math.min(FLUSH_RETRY_MAX_MS, FLUSH_RETRY_MS * 2 ** (streak - 1)));
        return () => clearTimeout(id);
    }, [flushRetryTick]);

    useEffect(() => {
        flushDirtySnapshot();
    }, [
        debounceTriggers.accountName, debounceTriggers.character, enabled,
        immediateTriggers.activeJutsuTraining, immediateTriggers.activeTraining, immediateTriggers.hospitalized,
        immediateTriggers.missionBattleActive, immediateTriggers.missionProgress,
        immediateTriggers.pendingTravel,
    ]);
}
