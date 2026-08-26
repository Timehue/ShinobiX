/*
 * World phase — is it night, for everyone, right now.
 *
 * ONE world, ONE clock, exactly like shared/sector-weather: a pure function of
 * the server's UTC instant, so the server can VERIFY a night-gated objective
 * instead of taking a client's word for the hour.
 *
 * The boundaries are not invented here. They are the same ones the visible sky
 * already uses — `phaseFor()` in shinobij.client/src/lib/day-cycle.ts returns
 * "night" for h >= 20 or h < 5, off the same UTC world clock — because a gate
 * that disagreed with what the player can see out of the window would read as a
 * bug no matter which side was "right". `world-phase.test.ts` pins the two
 * together so neither can drift alone.
 *
 * Note the client's dev-only `dayCycle.hour` pin deliberately has NO equivalent
 * here: it can shift the sky on a dev build, and it must never shift a gate the
 * server enforces.
 */

/** Night begins at this UTC hour. */
export const NIGHT_START_HOUR = 20;
/** ...and ends at this one. */
export const NIGHT_END_HOUR = 5;

/** Continuous UTC hour (0–24) for a ms timestamp. Pure. */
export function worldHourAt(nowMs: number): number {
    const n = Number(nowMs);
    if (!Number.isFinite(n)) return 0;
    const ms = ((n % 86_400_000) + 86_400_000) % 86_400_000;
    return ms / 3_600_000;
}

/**
 * Is the world in night at this instant?
 *
 * Fails CLOSED on a timestamp that is not a real instant. `worldHourAt` folds
 * garbage to hour 0, which is inside the night window — so without this guard a
 * NaN clock would satisfy a night-gated objective rather than refuse it. A gate
 * that opens on malformed input is not a gate.
 */
export function isWorldNight(nowMs: number): boolean {
    if (!Number.isFinite(Number(nowMs))) return false;
    const hour = worldHourAt(nowMs);
    return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** Human-readable window, for UI that has to tell a player when to come back. */
export function worldNightWindowLabel(): string {
    return `${String(NIGHT_START_HOUR).padStart(2, "0")}:00–${String(NIGHT_END_HOUR).padStart(2, "0")}:00 UTC`;
}
