// Visibility-aware polling helper for screen-level network polls.
//
// Drop-in replacement for the `const id = setInterval(fn, ms); return () =>
// clearInterval(id);` pattern: skips the tick while the tab is backgrounded
// (document.hidden) so parked-but-hidden screens stop hammering the API, fires
// `fn` once immediately when the tab becomes visible again (so a returning
// player gets fresh data without waiting a full interval), and jitters each
// interval by ±`jitterPct` to de-synchronise clients (avoids a thundering-herd
// of beats landing on the same wall-clock tick after a deploy bounce).
//
// Mirrors the visibility discipline already used by the App-level polls and
// lib/mail-unread.ts. It deliberately does NOT call `fn` on start (callers keep
// their own mount-fetch). Set immediate to let this helper own the mount-fetch
// as well. Async callbacks must return their promise: the next poll waits for
// it to settle, including after a visibility change. Callers still own response
// cancellation/alive guards and must not return before their request finishes.
//
// Returns a cleanup function — use it as the effect's return value:
//   useEffect(() => visiblePoll(refresh, 15000, 0.1, { immediate: true }), [refresh]);

export function visiblePoll(
    fn: () => void | Promise<unknown>,
    intervalMs: number,
    jitterPct = 0.1,
    options: { immediate?: boolean } = {},
): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight = false;

    const nextDelay = () => {
        if (jitterPct <= 0) return intervalMs;
        // ±jitterPct around the base interval.
        const spread = intervalMs * jitterPct;
        return intervalMs - spread + Math.random() * spread * 2;
    };

    const clearTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const schedule = () => {
        clearTimer();
        if (!stopped && !document.hidden && !inFlight) timer = setTimeout(run, nextDelay());
    };
    const run = async () => {
        clearTimer();
        if (stopped || document.hidden || inFlight) return;
        inFlight = true;
        try {
            await fn();
        } catch (error) {
            // Keep the poll recoverable without an unhandled rejection or a
            // tight retry loop. Screen callbacks normally handle their errors.
            console.error('[visiblePoll]', error);
        } finally {
            inFlight = false;
            schedule();
        }
    };

    const onVisible = () => {
        clearTimer();
        if (!document.hidden && !stopped) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    if (options.immediate) void run();
    else schedule();

    return () => {
        stopped = true;
        clearTimer();
        document.removeEventListener('visibilitychange', onVisible);
    };
}
