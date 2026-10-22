/*
 * One rule for every server writer that stamps `lastDailyReset` (2026-10
 * economy rebalance, PET-8).
 *
 * Several daily counters share that one stamp: the server reads each of them
 * as "today's" only when `lastDailyReset === today`, and the save sanitizer
 * floors each at its stored value within the stamped day
 * (api/save/_sanitize-claims-hospital.ts). A writer that moved the stamp to a
 * new day while resetting only its OWN counter left the others holding
 * yesterday's counts under today's stamp. The floor then kept them there, so
 * the client's own day reset could not repair it: yesterday's 100 arena wins
 * closed the arena for the whole day, and yesterday's 20 missions closed the
 * mission board. Each writer spreads this helper BEFORE its own counter
 * fields, so its own value still wins.
 */

/** The counters whose day is `lastDailyReset`. Never add dailyHuntsCompleted
 *  (its day is lastHuntReset) or dailyTowerXp (server-owned elsewhere). */
export const LAST_DAILY_RESET_COUNTERS = ['dailyPetWins', 'dailyMissionsCompleted', 'dailyFateSpins', 'dailyHollowGateRuns'] as const;

/**
 * The fields that stamp `todayKey` as the character's daily-reset day.
 *
 * Monotonic: a stored stamp NEWER than `todayKey` (a delayed settlement that
 * belongs to an earlier day) returns nothing, so it can never rewind the stamp
 * or zero a later day's counters, which would reopen that day's caps. The same
 * day only restamps. Only an older stored day zeroes the shared counters, and
 * only those holding a stale non-zero count, so a save gains no new fields.
 */
export function advanceLastDailyReset(char: Record<string, unknown>, todayKey: string): Record<string, unknown> {
    const stored = typeof char.lastDailyReset === 'string' ? char.lastDailyReset : '';
    if (stored > todayKey) return {};
    if (stored === todayKey) return { lastDailyReset: todayKey };
    const zeroed: Record<string, unknown> = {};
    for (const counter of LAST_DAILY_RESET_COUNTERS) {
        const value = Number(char[counter] ?? 0);
        if (!Number.isFinite(value) || value !== 0) zeroed[counter] = 0;
    }
    return { ...zeroed, lastDailyReset: todayKey };
}
