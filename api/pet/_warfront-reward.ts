/** One Coach completion and mastery claim per finished Manual match, up to the
 * same UTC-day cap. Kept in a dependency-free module so Start can disclose the
 * exact contract and Result can enforce it without a circular import. */
export const WARFRONT_COACH_COMPLETION_DAILY_CAP = 3;

/** Existing Arena base-reward curve, applied to the server-sealed average AI
 * level. Coach receives this base only: no outcome or first-win multiplier. */
export function warfrontBaseRyoReward(opponentLevel: number): number {
    const level = Math.max(1, Math.min(100, Math.floor(Number.isFinite(opponentLevel) ? opponentLevel : 1)));
    return Math.max(20, level * 2);
}
