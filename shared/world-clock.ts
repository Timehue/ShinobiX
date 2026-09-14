/*
 * World clock — how fast the shinobi world's day runs.
 *
 * ONE world, ONE clock (the same principle as shared/sector-weather and
 * shared/world-phase): a pure function of the server's UTC instant, so every
 * player everywhere is in the same hour of the same in-world day, and the
 * server can VERIFY a time-gated objective instead of taking a client's word
 * for the hour.
 *
 * WHY THE WORLD'S DAY IS NOT A REAL DAY
 * -------------------------------------
 * Until now the in-world hour WAS the real UTC hour. That reads fine in a
 * screenshot and badly in a session: a player whose evening is 19:00-21:00
 * local sees the same slice of sky every single night of their life, and never
 * sees dawn. Worse, it taxes people by timezone — a night-gated contract
 * (shared/sector-contracts) landed inside working hours for half the map.
 *
 * So the world's day is COMPRESSED, which is what live games do: Guild Wars 2
 * runs a 2-hour cycle, Final Fantasy XIV a 70-minute one. We take 2 hours,
 * which lands the phase split close to GW2's (~75 real minutes of dawn→dusk,
 * ~45 of night) while leaving the dawn and dusk ramps long enough — 12.5 and 15
 * real minutes — to actually watch the light change rather than blink and miss
 * it.
 *
 * 2 hours divides 24 exactly, so there are 12 in-world days per real day and
 * in-world midnight lands on the even UTC hours. That is not a coincidence to
 * rely on, but it does make the clock easy to reason about while debugging.
 *
 * PURE, SHARED, AND CHEAP
 * -----------------------
 * No state, no storage, no network, no assets. Client reads it through
 * lib/server-clock `serverNow()`, the server through `Date.now()`, and both get
 * the identical hour — which is what lets shared/sector-weather derive a
 * forecast the server will agree with when it seals a fight.
 */

/** One in-world day, in real milliseconds. The whole dial is this number. */
export const WORLD_DAY_MS = 2 * 60 * 60 * 1_000;

/** One in-world hour, in real milliseconds (5 real minutes). */
export const WORLD_HOUR_MS = WORLD_DAY_MS / 24;

/**
 * A real day. Present to name the invariant below, not because anything here
 * counts in real days.
 */
export const REAL_DAY_MS = 86_400_000;

/**
 * How many in-world days pass in one real day (12 at a 2-hour cycle).
 *
 * ASSERTED, NOT CALLED — deliberately. Nothing in the runtime needs the ratio;
 * what needs it is the invariant that it is a WHOLE number, because a real UTC
 * midnight is then also an in-world day boundary. Four test files build "an
 * instant at in-world hour H" as `Date.UTC(y, m, d) + H * WORLD_HOUR_MS`, which
 * is only correct while that holds. Naming it here, with `world-clock.test.ts`
 * pinning it, is what stops a retune of WORLD_DAY_MS to some value that does not
 * divide 24 hours from quietly invalidating those fixtures instead of failing
 * one obvious assertion.
 */
export const WORLD_DAYS_PER_REAL_DAY = REAL_DAY_MS / WORLD_DAY_MS;

/**
 * Continuous in-world hour (0–24) at a real instant. Pure.
 *
 * Folds a non-instant to hour 0 rather than throwing, because every caller here
 * is on a render or gating path that must not explode on a junk clock. Hour 0
 * is INSIDE the night window, so callers that gate on night must reject a
 * non-finite input themselves before asking — see `isWorldNight`.
 */
export function worldHourAt(nowMs: number): number {
    const n = Number(nowMs);
    if (!Number.isFinite(n)) return 0;
    const ms = ((n % WORLD_DAY_MS) + WORLD_DAY_MS) % WORLD_DAY_MS;
    return (ms / WORLD_DAY_MS) * 24;
}
