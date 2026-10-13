/*
 * Timing for the PvP battle stream (/api/pvp/stream), the battle screen's one
 * live transport. PvP is the game's core feature, so the goal is that a player
 * never sees the board hesitate for a reason they could not have caused:
 *
 *  - The server says `reconnect` when it ends a stream on purpose (the 13-minute
 *    renewal, or a deploy handing the battle to the new server). The client is
 *    back almost at once, and the badge never shows.
 *  - A real error retries in under a second the first time, then backs off
 *    (1.5 s, 3 s, 6 s, 10 s cap) so a sustained outage stays inside the
 *    server's 30-per-minute stream budget.
 *  - "Reconnecting..." only appears when the gap outlives
 *    PVP_RECONNECT_BADGE_GRACE_MS. A gap shorter than that is invisible: the
 *    reconnected stream sends the full session the moment it opens, and moves
 *    never wait on the stream (they are their own requests).
 */

/** How long a gap must last before the "Reconnecting..." badge appears. */
export const PVP_RECONNECT_BADGE_GRACE_MS = 1_500;

/**
 * An open stream that has delivered nothing (no session, no ping) for this long
 * is treated as silently dead (a half-open connection after a network switch)
 * and reopened like a planned reconnect. The server pings every 15 s
 * (api/pvp/stream.ts HEARTBEAT_INTERVAL_MS), so a quiet fight never trips it.
 */
export const PVP_STREAM_SILENCE_LIMIT_MS = 40_000;

/**
 * A stream must stay up this long before its failures are forgiven. Resetting
 * on the first frame let a stream that connects then dies loop at the fastest
 * retry until it hit the server's 30-per-minute budget.
 */
export const PVP_STREAM_HEALTHY_AFTER_MS = 5_000;

/** Spread for answering a server `reconnect`, so a whole server's viewers don't land in one instant. */
export const PVP_STREAM_HANDOFF_SPREAD_MS = 300;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Delay before reopening after the server asked for a reconnect. */
export function pvpStreamHandoffDelayMs(random: () => number = Math.random): number {
    return Math.round(clamp01(random()) * PVP_STREAM_HANDOFF_SPREAD_MS);
}

/**
 * Delay before reopening after a stream error. `failures` counts consecutive
 * errors including this one; any accepted session resets it.
 *
 * Before the first session the retry stays a flat 1.5 s, so a battle that never
 * existed is still reported within a few seconds.
 */
export function pvpStreamRetryDelayMs(failures: number, hasLoadedSession: boolean, random: () => number = Math.random): number {
    if (!hasLoadedSession) return 1_500;
    const n = Math.max(1, Math.floor(failures));
    if (n === 1) return Math.round(500 + clamp01(random()) * 500);
    return Math.min(10_000, 1_500 * 2 ** (n - 2));
}
