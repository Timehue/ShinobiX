/*
 * How long a dropped presence socket waits before its first reconnect.
 *
 * A Railway deploy closes every socket in the same instant. socket.io's own
 * jitter (±50% around a shared 1 s base) still lands every client's first
 * retry inside one ~1 s window, onto a process whose caches and database pool
 * are cold, and each reconnect fans out into a presence write, a sector
 * roster, a heartbeat and chat refetches. The production capacity test
 * (2026-10-12) showed that ~200 arrivals inside one second is enough to queue
 * thousands of requests on the pool.
 *
 * So each drop picks its own base delay: a few seconds, spread uniformly, for
 * a player who is just walking around; under a second for a player in a fight,
 * whose turn clock keeps running on the server. socket.io still applies its
 * ±50% jitter and doubling on top, capped by RECONNECT_DELAY_MAX_MS.
 */

/** In a fight: back within about a second. */
export const RECONNECT_IN_BATTLE_MS = { min: 500, max: 1_000 } as const;
/** Everyone else: spread across a few seconds. */
export const RECONNECT_SPREAD_MS = { min: 1_000, max: 5_000 } as const;
/** socket.io's cap on the doubled delay; unchanged from before the spread. */
export const RECONNECT_DELAY_MAX_MS = 8_000;
/** socket.io's own per-attempt jitter, made explicit (it is the library default). */
export const RECONNECT_RANDOMIZATION_FACTOR = 0.5;

export function reconnectBaseDelayMs(inBattle: boolean, random: () => number = Math.random): number {
    const { min, max } = inBattle ? RECONNECT_IN_BATTLE_MS : RECONNECT_SPREAD_MS;
    const r = Math.max(0, Math.min(1, random()));
    return Math.round(min + r * (max - min));
}
