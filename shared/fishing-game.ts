export type FishingEvent = { kind: 'hook' | 'reel' | 'release'; at: number };
export const FISHING_REEL_MS = 6500;
/** Deterministic line simulation, replayed by server and client with the same rules.
 * Event timestamps are elapsed server-admitted milliseconds, never a submitted score. */
export function scoreFishing(hookAt: number, events: unknown, elapsed: number, preview = false) {
    if (!Array.isArray(events) || events.length < (preview ? 1 : 2) || events.length > 48) return null;
    const input = events as FishingEvent[];
    if (input.some((e, i) => !e || !['hook', 'reel', 'release'].includes(e.kind) || !Number.isFinite(e.at)
        || e.at < 0 || e.at > elapsed + 250 || (i > 0 && e.at < input[i - 1].at))) return null;
    if (input[0].kind !== 'hook' || input.slice(1).some(e => e.kind === 'hook')) return null;
    const hook = input[0].at;
    if (hook < hookAt - 150 || hook > hookAt + 1200) return { failed: true, performance: 0, tension: 0, progress: 0 };
    if (!preview && elapsed < hook + FISHING_REEL_MS) return null;
    let tension = 35, progress = 0, held = false, cursor = 1, safe = 0;
    for (let at = hook; at < Math.min(elapsed, hook + FISHING_REEL_MS); at += 50) {
        while (cursor < input.length && input[cursor].at <= at) {
            const event = input[cursor++];
            if ((event.kind === 'reel') === held) return null;
            held = event.kind === 'reel';
        }
        tension = Math.max(0, tension + (held ? 1.1 : -1.5) + Math.sin((at - hook) / 430) * .3);
        if (tension >= 100) return { failed: true, performance: 0, tension: 100, progress };
        if (held && tension >= 20 && tension <= 80) { progress += 1; safe++; }
    }
    return { failed: progress < 30, performance: Math.min(10, Math.floor(safe / 7)), tension, progress: Math.min(100, progress * 2) };
}
