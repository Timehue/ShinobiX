/*
 * How a Beastbound Warfront clash keeps playing when its graphics do not.
 *
 * The outcome of a clash is already decided before it is drawn: the sealed
 * bands, the seed and the committed plan fix every hit. A renderer only shows
 * that replay, so no rendering failure is a reason to stop it. The playback
 * clock pauses while the view is unavailable (so no beat plays unseen), which
 * makes every unavailable state a potential dead end unless it is bounded.
 *
 * Three routes, from richest to plainest:
 *   webgl   — the 3D rigs (PetWarfrontRiteStage3D)
 *   canvas  — the Canvas 2D model impostors
 *   reduced — plain DOM tokens and health bars; no images, canvas or GPU
 *
 * Each failure moves one step down and nothing ever moves back on its own, so
 * any sequence of failures ends on `reduced`, which has nothing to load and so
 * cannot fail. The only way back up is the player's own "Retry" from there.
 */

export type WarfrontStageRoute = "webgl" | "canvas" | "reduced";

export type WarfrontStageFailures = Readonly<{ webgl: boolean; canvas: boolean }>;

/** Which presentation a clash uses. `preferWebGl` is the hardware/atlas routing
 * decision made before the first clash; failures override it. */
export function warfrontStageRoute(preferWebGl: boolean, failures: WarfrontStageFailures): WarfrontStageRoute {
    if (failures.webgl && failures.canvas) return "reduced";
    if (failures.webgl) return "canvas";
    return preferWebGl || failures.canvas ? "webgl" : "canvas";
}

/**
 * Browsers drop WebGL contexts under memory pressure and on GPU resets, and an
 * in-place restore usually brings the battle back within a few seconds. These
 * bound that restore: it may take this many seconds of VISIBLE time (a hidden
 * tab neither draws nor plays), and it may happen this many times in one match.
 * A device that cannot restore in time, or keeps losing the context, is handed
 * to the lighter routes instead of pausing the battle again.
 */
export const WARFRONT_CONTEXT_RESTORE_DEADLINE_SECONDS = 15;
export const WARFRONT_CONTEXT_RESTORE_LIMIT = 2;

/** `lossCount` includes the loss being handled. */
export function warfrontContextLossRecovery(lossCount: number): "restore" | "fall-back" {
    return lossCount > WARFRONT_CONTEXT_RESTORE_LIMIT ? "fall-back" : "restore";
}

export type WarfrontVisibleClock = {
    setInterval: (callback: () => void, delayMs: number) => number;
    clearInterval: (handle: number) => void;
    hidden: () => boolean;
};

const browserVisibleClock: WarfrontVisibleClock = {
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (handle) => window.clearInterval(handle),
    hidden: () => document.hidden,
};

/**
 * Call `onExpire` once `seconds` of visible time have passed. Hidden seconds
 * do not count, matching the stage's own preparation deadline. Returns a
 * cancel function; cancelling after expiry is harmless.
 */
export function startWarfrontVisibleCountdown(
    seconds: number,
    onExpire: () => void,
    clock: WarfrontVisibleClock = browserVisibleClock,
): () => void {
    let remaining = Math.max(1, Math.ceil(seconds));
    let handle: number | null = null;
    const cancel = () => {
        if (handle === null) return;
        clock.clearInterval(handle);
        handle = null;
    };
    handle = clock.setInterval(() => {
        if (clock.hidden()) return;
        remaining -= 1;
        if (remaining > 0) return;
        cancel();
        onExpire();
    }, 1_000);
    return cancel;
}
