/**
 * Hex-board PvP turn clock — the single source of truth for the per-turn
 * deadline read by BOTH the browser countdown (`CombatRoundTimer`) and the
 * server's authoritative turn-expiry enforcement (`api/pvp/_turn-deadline.ts`).
 *
 * The server is the authority on turn expiry. The client timer is a courtesy
 * display that also self-reports an `auto: true` wait when it hits zero, but a
 * closed tab never reports anything — so the server applies the same auto-wait
 * itself once a turn is older than `PVP_TURN_MS + PVP_TURN_GRACE_MS`.
 *
 * Not to be confused with the other, separate turn clocks that exist in this
 * repo: `TOWER_PVP_TURN_MS` (75s, Battle Towers team PvP) and
 * `SHOWDOWN_PVP_TURN_SECONDS` (pet Showdown). Those are different engines with
 * their own server-side deadlines; do not fold them into this constant.
 */

/** Seconds a fighter gets per turn on the hex board (PvP and the PvE arena). */
export const PVP_TURN_SECONDS = 45 as const;
export const PVP_TURN_MS = PVP_TURN_SECONDS * 1000;

/**
 * Network slack the server allows past `PVP_TURN_MS` before it auto-waits a
 * lapsed turn. Keeps a client whose own `auto: true` wait is in flight from
 * racing the server's enforcement in the common case.
 *
 * Sized as defence in depth, not as a fudge factor: the browser countdown is
 * anchored to `turnStartedAt` and fires its own `wait` at `PVP_TURN_MS`
 * (`pvpTurnClientExpiryAt` below), so the client is ALWAYS structurally earlier
 * than the server. The grace only has to cover the round trip of that wait —
 * and the slowest way it can arrive is the 5s poll fallback used when the
 * Realtime socket is down, on top of mobile-network latency. 3s was under that
 * floor, so a present player on a poor connection could be auto-passed by the
 * server while their own wait was still in flight; 8s clears it with room.
 */
export const PVP_TURN_GRACE_MS = 8_000 as const;

/**
 * How far ahead of the server's deadline the browser's own countdown must hit
 * zero. The client's auto-wait is the polite path (it carries `auto: true` and
 * the player's real action history); the server's enforcement is the backstop
 * for a tab that is gone. Keeping the client structurally first means the
 * backstop only ever fires for an absent player.
 */
export const PVP_TURN_CLIENT_LEAD_MS = 2_000 as const;

/**
 * "X goes first!" pre-fight countdown shown once both fighters are on the
 * board. The server starts the first turn's clock AFTER this countdown so the
 * opening fighter still sees the full `PVP_TURN_SECONDS`.
 */
export const PVP_PREFIGHT_COUNTDOWN_SECONDS = 5 as const;
export const PVP_PREFIGHT_COUNTDOWN_MS = PVP_PREFIGHT_COUNTDOWN_SECONDS * 1000;

/** Absolute time after which the server treats the active turn as lapsed. */
export function pvpTurnDeadlineAt(turnStartedAt: number): number {
    return turnStartedAt + PVP_TURN_MS + PVP_TURN_GRACE_MS;
}

/**
 * Absolute time the BROWSER's countdown should hit zero (and self-report a
 * `wait`). Normally just `turnStartedAt + PVP_TURN_MS` — the honest 45s the
 * player is shown — but never later than `PVP_TURN_CLIENT_LEAD_MS` before the
 * server's own deadline, so retuning the grace can never invert the two.
 */
export function pvpTurnClientExpiryAt(turnStartedAt: number): number {
    return Math.min(
        turnStartedAt + PVP_TURN_MS,
        pvpTurnDeadlineAt(turnStartedAt) - PVP_TURN_CLIENT_LEAD_MS,
    );
}

/**
 * Whole seconds left on the visible countdown, anchored to the SERVER's
 * `turnStartedAt` rather than to when the timer component happened to mount.
 *
 * Pure so it is node-testable, and absolute so it is immune to the two things
 * that broke the old mount-time countdown: a refresh mid-turn (which used to
 * restart the ring at a full 45 seconds before the server passed the turn), and
 * a background tab whose 1s interval is throttled (the next tick simply lands on
 * the true value instead of accumulating lost ticks).
 *
 * `now` must come from `lib/server-clock.ts serverNow()` on the client — the
 * anchor was minted by the server's clock, so comparing it to a drifting local
 * `Date.now()` reintroduces the same class of bug.
 */
export function pvpTurnRemainingSeconds(
    turnStartedAt: number,
    now: number,
    seconds: number = PVP_TURN_SECONDS,
): number {
    if (!Number.isFinite(turnStartedAt) || turnStartedAt <= 0) return seconds;
    const remaining = Math.ceil((pvpTurnClientExpiryAt(turnStartedAt) - now) / 1000);
    return Math.max(0, Math.min(seconds, remaining));
}
