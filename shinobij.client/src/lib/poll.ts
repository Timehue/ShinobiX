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
// their own mount-fetch) and does NOT touch the caller's fetch fn / alive
// guards, so migrating a poll is a one-line change with no behavioural risk
// beyond "no longer polls while hidden".
//
// Returns a cleanup function — use it as the effect's return value:
//   useEffect(() => { void refresh(); return visiblePoll(refresh, 15000); }, [deps]);

export function visiblePoll(
    fn: () => void,
    intervalMs: number,
    jitterPct = 0.1,
): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const nextDelay = () => {
        if (jitterPct <= 0) return intervalMs;
        // ±jitterPct around the base interval.
        const spread = intervalMs * jitterPct;
        return intervalMs - spread + Math.random() * spread * 2;
    };

    const loop = () => {
        timer = setTimeout(() => {
            if (stopped) return;
            // Skip the network tick while hidden; keep the loop alive so it
            // resumes on its own once the tab is foregrounded again.
            if (!document.hidden) fn();
            loop();
        }, nextDelay());
    };
    loop();

    const onVisible = () => {
        if (!document.hidden && !stopped) fn(); // catch up immediately on return
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
    };
}
