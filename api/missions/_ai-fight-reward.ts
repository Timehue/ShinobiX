/*
 * Pure soft-cap math for daily AI-fight rewards (P0.2b). The first
 * AI_FIGHT_SOFT_CAP_PER_DAY AI wins each UTC day pay full XP/ryo; beyond that the
 * reward is multiplied by AI_FIGHT_REDUCED_MULT so a grinder can't blow past the
 * ~90-day progression curve — without walling a normal active player. Deliberately
 * GENEROUS; tune these before enabling AI_FIGHT_SERVER_AUTH / aiFightServerAuth.v1.
 *
 * The per-fight clamps are anti-inflation safety rails on the client-reported base
 * (legit max today is 125 XP "Swift" / 90 ryo "Lucky"; the headroom covers future
 * trait/content tweaks without re-touching this file).
 */

export const AI_FIGHT_SOFT_CAP_PER_DAY = 50;   // full reward for the first N AI wins/day
export const AI_FIGHT_REDUCED_MULT = 0.25;     // reward multiplier past the soft cap
export const MAX_AI_FIGHT_XP = 150;            // per-fight base XP clamp (legit max 125)
export const MAX_AI_FIGHT_RYO = 150;           // per-fight base ryo clamp (legit max 90)
// TTL on the date-keyed daily counter so old date keys self-evict (a bit over a day).
export const AI_FIGHT_DAILY_COUNT_TTL_SECONDS = 26 * 60 * 60;

export type AiFightReward = { xp: number; ryo: number; capped: boolean };

/**
 * Allowed XP/ryo for ONE AI win, given the day's running win count (including
 * this win). Clamps the client-reported base, then applies the soft-cap multiplier.
 */
export function aiFightReward(claimedXp: unknown, claimedRyo: unknown, dailyCountIncludingThis: number): AiFightReward {
    const xpBase = Math.max(0, Math.min(MAX_AI_FIGHT_XP, Math.floor(Number(claimedXp) || 0)));
    const ryoBase = Math.max(0, Math.min(MAX_AI_FIGHT_RYO, Math.floor(Number(claimedRyo) || 0)));
    const overCap = Number(dailyCountIncludingThis) > AI_FIGHT_SOFT_CAP_PER_DAY;
    const mult = overCap ? AI_FIGHT_REDUCED_MULT : 1;
    return { xp: Math.floor(xpBase * mult), ryo: Math.floor(ryoBase * mult), capped: overCap };
}
