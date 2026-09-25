import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CapabilityAvailability } from "./live-capabilities";
import { capabilityAdmissionAllowed } from "./live-capability-admission";
import { AUTOSAVE_RETRY } from "./save-persistence";
import { isIdleVitalsOnlyChange } from "./loaded-vitals";

type MutableBox<T> = { current: T };

/** How soon a deferred immediate flush tries again (the blocking save is ≤ ~3s). */
const FLUSH_RETRY_MS = 1_000;
const FLUSH_RETRY_MAX_MS = 8_000;

export type DebounceTriggers = Readonly<{
    character: unknown;
    accountName: string;
    sector: unknown;
    pendingTravel: unknown;
    missionBattleActive: boolean;
}>;

/**
 * True when the only debounce trigger that moved is one idle-regeneration tick.
 *
 * While any vital is below its maximum (after every fight, for up to
 * REGEN_FULL_BAR_SEC), App's regen tick replaces the character object each
 * second. The tick never dirties the save (isIdleVitalsOnlyChange), and it must
 * not restart the 3s countdown either. If it did, the countdown would never
 * finish, and a real change made while vitals refill, such as a seen finale
 * epilogue or a story choice, would wait for the 15s interval instead. That
 * interval also restarts whenever a fight opens or closes, so a change made
 * just after a fight would wait the full 15s.
 */
export function isIdleRegenTickOnly(previous: DebounceTriggers | null, next: DebounceTriggers): boolean {
    return !!previous
        && previous.accountName === next.accountName
        && Object.is(previous.sector, next.sector)
        && Object.is(previous.pendingTravel, next.pendingTravel)
        && previous.missionBattleActive === next.missionBattleActive
        && isIdleVitalsOnlyChange(previous.character, next.character);
}

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

    const lastDebounceTriggersRef = useRef<DebounceTriggers | null>(null);
    useEffect(() => {
        const previous = lastDebounceTriggersRef.current;
        const current: DebounceTriggers = {
            character: debounceTriggers.character, accountName: debounceTriggers.accountName, sector: debounceTriggers.sector,
            pendingTravel: debounceTriggers.pendingTravel, missionBattleActive: debounceTriggers.missionBattleActive,
        };
        lastDebounceTriggersRef.current = current;
        const cancel = () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
        if (!enabled || !current.character || !current.accountName || !dirtyRef.current || intervalPresenceActive) {
            cancel();
            return;
        }
        // Keep a running countdown through an idle-regen tick. See
        // isIdleRegenTickOnly for why restarting it would starve the debounce.
        if (debounceTimerRef.current && isIdleRegenTickOnly(previous, current)) return;
        cancel();
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            persistDirtySnapshot();
        }, 3000);
    }, [
        debounceTimerRef, debounceTriggers.accountName, debounceTriggers.character,
        debounceTriggers.missionBattleActive, debounceTriggers.pendingTravel,
        debounceTriggers.sector, dirtyRef, enabled, intervalPresenceActive, latestSnapshotRef,
    ]);
    // The countdown above now survives a re-run, so unmount clears it here.
    useEffect(() => () => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
    }, [debounceTimerRef]);

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
