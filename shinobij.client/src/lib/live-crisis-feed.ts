// One shared poll of the two public world-crisis projections for the global
// herald (components/LiveServiceNotice.tsx).
//
// The herald renders inside App's screen-keyed error boundary, so every screen
// change unmounts and remounts it. When it owned its own poll, each navigation
// fired both crisis requests again on top of the 15s cadence. The poll now lives
// here and survives that brief unmount/mount: a remounted herald receives the
// latest frame at once and the 15s rhythm is unchanged. When no herald has been
// mounted for STOP_GRACE_MS (e.g. a story event is open), the poll stops, and the
// next subscriber starts it with an immediate fetch — exactly as before.
import type { WorldCrisisProjection } from "../../../shared/world-crisis";
import type { WorldCrisis80Projection } from "../../../shared/world-crisis-80";
import { visiblePoll } from "./poll";
import { fetchWorldCrisis } from "./world-crisis";
import { fetchWorldCrisis80 } from "./world-crisis-80";

export const LIVE_CRISIS_POLL_MS = 15_000;
export const LIVE_CRISIS_STOP_GRACE_MS = 2_000;

export type LiveCrisisFrame = {
    crisis: WorldCrisisProjection | null;
    reckoning: WorldCrisis80Projection | null;
};
type Listener = (frame: LiveCrisisFrame) => void;

export type LiveCrisisFeedDeps = {
    fetchCrisis: () => Promise<WorldCrisisProjection | null>;
    fetchReckoning: () => Promise<WorldCrisis80Projection | null>;
    /** Start the repeating poll (its first run is immediate); returns a stop function. */
    startPoll: (refresh: () => Promise<void>) => () => void;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
};

export function createLiveCrisisFeed(deps: LiveCrisisFeedDeps) {
    const listeners = new Set<Listener>();
    let latest: LiveCrisisFrame = { crisis: null, reckoning: null };
    let stopPoll: (() => void) | null = null;
    let stopTimer: unknown = null;

    const refresh = async () => {
        const [crisis, reckoning] = await Promise.all([deps.fetchCrisis(), deps.fetchReckoning()]);
        // A failed read keeps the last good frame, as the herald always did.
        latest = { crisis: crisis ?? latest.crisis, reckoning: reckoning ?? latest.reckoning };
        for (const listener of listeners) listener(latest);
    };

    return function subscribe(listener: Listener): () => void {
        listeners.add(listener);
        if (stopTimer !== null) {
            deps.clearTimer(stopTimer);
            stopTimer = null;
        }
        if (stopPoll) listener(latest);
        else stopPoll = deps.startPoll(refresh);
        return () => {
            listeners.delete(listener);
            if (listeners.size || stopTimer !== null) return;
            stopTimer = deps.setTimer(() => {
                stopTimer = null;
                if (listeners.size || !stopPoll) return;
                stopPoll();
                stopPoll = null;
            }, LIVE_CRISIS_STOP_GRACE_MS);
        };
    };
}

export const subscribeLiveCrisisFeed = createLiveCrisisFeed({
    fetchCrisis: fetchWorldCrisis,
    fetchReckoning: fetchWorldCrisis80,
    startPoll: (refresh) => visiblePoll(refresh, LIVE_CRISIS_POLL_MS, 0.1, { immediate: true }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});
