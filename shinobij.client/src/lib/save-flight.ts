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

export type CompletedSaveFlight<T> = Readonly<{
    status: "completed";
    value: T;
}>;

export type DeferredSaveFlight = Readonly<{
    status: "deferred";
}>;

export type AutosaveFlightResult<T> = CompletedSaveFlight<T> | DeferredSaveFlight;

/**
 * Coordinates every write to one player's full save payload.
 *
 * Autosaves are disposable snapshots: when another write is active (or a
 * required write is queued), they are deferred so the caller can leave the
 * payload dirty and rebuild it on the next tick. Required/immediate saves are
 * user-visible durability boundaries, so they queue FIFO and their returned
 * promise does not settle until their own work has actually completed.
 */
export interface SaveFlightCoordinator {
    /** True while work is active or a required write is waiting. */
    busy(): boolean;
    /** Number of required writes waiting behind the active operation. */
    pendingRequired(): number;
    /** Run now only when idle; otherwise return a typed deferred result. */
    runAutosave<T>(work: () => Promise<T>): Promise<AutosaveFlightResult<T>>;
    /** Queue FIFO when busy and wait for this specific write to complete. */
    runRequired<T>(work: () => Promise<T>): Promise<CompletedSaveFlight<T>>;
}

type RequiredSaveJob = () => void;

export function createSaveFlightCoordinator(): SaveFlightCoordinator {
    let active = false;
    const requiredQueue: RequiredSaveJob[] = [];

    const drain = () => {
        active = false;
        const next = requiredQueue.shift();
        if (next) next();
    };

    const execute = <T>(
        work: () => Promise<T>,
        resolve: (result: CompletedSaveFlight<T>) => void,
        reject: (reason?: unknown) => void,
    ) => {
        active = true;
        void (async () => {
            try {
                resolve({ status: "completed", value: await work() });
            } catch (error) {
                reject(error);
            } finally {
                // Drain synchronously before promise continuations can enqueue a
                // lower-priority autosave ahead of a required waiter.
                drain();
            }
        })();
    };

    return {
        busy: () => active || requiredQueue.length > 0,
        pendingRequired: () => requiredQueue.length,
        runAutosave<T>(work: () => Promise<T>): Promise<AutosaveFlightResult<T>> {
            if (active || requiredQueue.length > 0) {
                return Promise.resolve({ status: "deferred" });
            }
            return new Promise<CompletedSaveFlight<T>>((resolve, reject) => {
                execute(work, resolve, reject);
            });
        },
        runRequired<T>(work: () => Promise<T>): Promise<CompletedSaveFlight<T>> {
            return new Promise<CompletedSaveFlight<T>>((resolve, reject) => {
                const start = () => execute(work, resolve, reject);
                if (active || requiredQueue.length > 0) requiredQueue.push(start);
                else start();
            });
        },
    };
}

/**
 * Advance this revision whenever ANY field included in the full save payload
 * changes. Comparing the captured revision after a request settles is safer
 * than checking only the Character object reference: mission, biome, sector,
 * training, and travel fields can change independently of that object.
 */
export function nextSavePayloadRevision(current: number): number {
    if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Save payload revision is invalid or exhausted.");
    }
    return current + 1;
}

/** True only when no full-payload field changed after the revision was captured. */
export function isCurrentSavePayloadRevision(captured: number, current: number): boolean {
    return Number.isSafeInteger(captured)
        && captured >= 0
        && Number.isSafeInteger(current)
        && current >= 0
        && captured === current;
}
