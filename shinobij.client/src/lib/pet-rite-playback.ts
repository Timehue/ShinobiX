/**
 * Presentation-clock policy for the Warfront rite.
 *
 * rAF is the smooth path, but it is not a reliable clock source when several
 * WebGL contexts contend for a software renderer. A bounded timer pulse keeps
 * authoritative playback moving while paint callbacks are sparse. The caller
 * still pauses for hidden documents and unavailable renderers, so this never
 * skips combat while it cannot be seen. Fifty milliseconds preserves the
 * renderer's original per-step displacement ceiling.
 */
export const RITE_PLAYBACK_WATCHDOG_MS = 50;
export const RITE_PLAYBACK_MAX_STEP_SECONDS = RITE_PLAYBACK_WATCHDOG_MS / 1000;

export type RitePlaybackScheduler = {
    now: () => number;
    requestFrame: (callback: (now: number) => void) => number;
    cancelFrame: (handle: number) => void;
    setTimer: (callback: () => void, delayMs: number) => number;
    clearTimer: (handle: number) => void;
};

/** Whichever arrives first (paint or watchdog) owns one pulse. */
export function startRitePlaybackPulses(
    scheduler: RitePlaybackScheduler,
    onPulse: (now: number) => void,
    watchdogMs = RITE_PLAYBACK_WATCHDOG_MS,
): () => void {
    let running = true;
    let armed = false;
    let frameHandle = 0;
    let timerHandle = 0;

    const arm = () => {
        if (!running) return;
        armed = true;
        frameHandle = scheduler.requestFrame(wake);
        timerHandle = scheduler.setTimer(() => wake(scheduler.now()), watchdogMs);
    };
    const wake = (now: number) => {
        if (!running || !armed) return;
        armed = false;
        scheduler.cancelFrame(frameHandle);
        scheduler.clearTimer(timerHandle);
        onPulse(now);
        arm();
    };

    arm();
    return () => {
        running = false;
        armed = false;
        scheduler.cancelFrame(frameHandle);
        scheduler.clearTimer(timerHandle);
    };
}

export function boundedRitePlaybackDelta(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
    return Math.min(RITE_PLAYBACK_MAX_STEP_SECONDS, elapsedMs / 1000);
}

export function advanceRitePlaybackTick(
    currentTick: number,
    totalTicks: number,
    deltaSeconds: number,
    ticksPerSecond: number,
    easedRate: number,
    playbackRate: number,
): number {
    return Math.min(totalTicks, currentTick + deltaSeconds * ticksPerSecond * easedRate * playbackRate);
}
