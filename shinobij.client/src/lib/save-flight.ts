/**
 * Serialise autosave POSTs so two never race on the same save version.
 *
 * Three independent triggers call the autosave: a 3s debounce on character change,
 * a 15s interval, and an immediate flush on training start / KO. Nothing stopped
 * two of them overlapping, and both read `_baseSaveVersion` from the same ref
 * BEFORE either reply lands — so both POST the same base version. The server
 * serialises them under a per-save lock, the first commits, and the second is
 * rejected 409. The client's 409 recovery refetches the server snapshot and
 * applies it wholesale, which reverts the newer payload to the older one that just
 * landed: the player watches a few seconds of progress undo itself.
 *
 * The gate drops the overlapping attempt rather than queueing it. A queued POST
 * would carry an already-stale snapshot; re-marking the save dirty instead lets the
 * next tick send the CURRENT state, which is strictly better and cannot pile up.
 */
/**
 * Consecutive failed autosaves before the save-error banner is shown.
 *
 * Was 4 for HTTP rejections and 6 for network errors. The autosave cadence is 15s, so
 * a ~30-second outage — a routine platform deploy, and near-certain during launch week
 * — produces only two or three attempts. At the old counts the banner could not fire
 * during the very incident it exists for: the player saw buttons that appeared to do
 * nothing, with no hint that their progress was unsaved and that refreshing would
 * destroy it.
 *
 * Two is deliberately low. A single transient blip still cannot trip it, and any
 * successful save resets the streak — so a false positive costs one dismissible banner,
 * while a false negative costs the player their unsaved progress on the next refresh.
 */
export const SAVE_FAILURE_BANNER_THRESHOLD = 2;

export interface SaveFlightGate {
    /** True when a save is in flight, so the caller should defer instead of POSTing. */
    busy(): boolean;
    /** Run `work` exclusively. Returns "deferred" without running if already busy. */
    run<T>(work: () => Promise<T>): Promise<T | "deferred">;
}

export function createSaveFlightGate(): SaveFlightGate {
    let inFlight = false;
    return {
        busy: () => inFlight,
        async run<T>(work: () => Promise<T>): Promise<T | "deferred"> {
            if (inFlight) return "deferred";
            inFlight = true;
            try {
                return await work();
            } finally {
                // Always clear, including on throw — a stuck flag would wedge every
                // later autosave for the rest of the session.
                inFlight = false;
            }
        },
    };
}
