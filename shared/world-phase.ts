/*
 * World phase — is it night, for everyone, right now.
 *
 * ONE world, ONE clock, exactly like shared/sector-weather: a pure function of
 * the server's instant, so the server can VERIFY a night-gated objective
 * instead of taking a client's word for the hour.
 *
 * The boundaries are not invented here. They are the same ones the visible sky
 * already uses — `phaseFor()` in shinobij.client/src/lib/day-cycle.ts returns
 * "night" for h >= 20 or h < 5, off the same world clock — because a gate that
 * disagreed with what the player can see out of the window would read as a bug
 * no matter which side was "right". `world-phase.test.ts` pins the two together
 * so neither can drift alone.
 *
 * The HOURS are in-world hours, not UTC hours: the world's day is compressed to
 * two real hours (shared/world-clock, and see its header for why). So night is
 * still 20:00–05:00 on the world's clock, but it comes around every two real
 * hours and lasts ~45 real minutes instead of falling on one fixed slab of the
 * real day. That is the point: a night-gated contract used to be unreachable
 * for whole timezones, and is now reachable by everyone in any session.
 *
 * Note the client's dev-only `dayCycle.hour` pin deliberately has NO equivalent
 * here: it can shift the sky on a dev build, and it must never shift a gate the
 * server enforces.
 */

import { WORLD_DAY_MS, worldHourAt as worldClockHourAt } from "./world-clock.js";

/** Night begins at this in-world hour. */
export const NIGHT_START_HOUR = 20;
/** ...and ends at this one. */
export const NIGHT_END_HOUR = 5;

/** Continuous in-world hour (0–24) for a ms timestamp. Pure. */
export function worldHourAt(nowMs: number): number {
    return worldClockHourAt(nowMs);
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

/**
 * Human-readable window, for UI that has to tell a player when to come back.
 *
 * Deliberately NOT a clock time any more. Under the compressed world clock
 * "20:00–05:00" would be read as a wall-clock instruction and be wrong for
 * everyone: night is a recurring window, not a slot in the player's evening.
 */
export function worldNightWindowLabel(): string {
    const everyHours = Math.round(WORLD_DAY_MS / 3_600_000);
    return `nightfall comes round every ${everyHours}h`;
}
