/**
 * When may the Tower ready-room's Leave button unlock during a wedged launch?
 *
 * While a party sits in "launching"/"active" the room locks its edits, so if the
 * server never completes the transition the player has no way out. Leave unlocks
 * after LAUNCH_TRANSITION_ESCAPE_MS — but *measuring* that window is the fiddly
 * part, and it is why this lives here instead of inline in the panel:
 *
 *  - Elapsed time is measured entirely on the client clock. Comparing
 *    `Date.now()` against the server's `updatedAt` put two unrelated clocks on
 *    either side of the subtraction, so a player minutes fast unlocked Leave
 *    during a perfectly normal launch, and a player minutes slow never unlocked
 *    it at all.
 *  - The first sighting persists, so a reload does not restart the wait. A
 *    player already wedged for minutes should not owe another full window just
 *    for refreshing.
 *  - It is keyed by party + status, so genuinely re-entering that status later
 *    starts a fresh window rather than inheriting a stale stamp.
 */
export const LAUNCH_TRANSITION_ESCAPE_MS = 60_000;
export const LAUNCH_ESCAPE_STORAGE_KEY = "towerLaunchStuckSince.v1";

/** The subset of Storage this needs; pass null when storage is unavailable. */
export interface EscapeClockStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/**
 * Resolve when the current stuck status was first seen, persisting it.
 * Returns null when nothing is stuck.
 *
 * `null` rather than 0 for "not stuck" on purpose: a numeric sentinel makes
 * "unset" and "the epoch" the same value, which is the kind of ambiguity that
 * reads fine and then quietly disables the whole escape hatch.
 */
export function resolveLaunchStuckSince(
    stuckStatusKey: string | null,
    now: number,
    store: EscapeClockStore | null,
): number | null {
    if (!stuckStatusKey) return null;
    let since: number | null = null;
    try {
        const raw = store?.getItem(LAUNCH_ESCAPE_STORAGE_KEY);
        const saved = raw ? JSON.parse(raw) as { key?: string; since?: number } : null;
        const savedSince = Number(saved?.since);
        // A stamp from the future is a clock that moved backwards, not a long
        // wait — discard it rather than open the hatch instantly.
        if (saved?.key === stuckStatusKey && Number.isFinite(savedSince) && savedSince <= now) since = savedSince;
    } catch { /* storage disabled, or a corrupt entry — fall through to `now` */ }

    if (since === null) {
        since = now;
        try {
            store?.setItem(LAUNCH_ESCAPE_STORAGE_KEY, JSON.stringify({ key: stuckStatusKey, since }));
        } catch { /* storage disabled — the in-memory value still works this session */ }
    }
    return since;
}

/** Has the stuck status outlived the escape window? */
export function launchEscapeOpen(stuckSince: number | null, now: number, windowMs = LAUNCH_TRANSITION_ESCAPE_MS): boolean {
    return stuckSince !== null && now - stuckSince > windowMs;
}
