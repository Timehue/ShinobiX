/** Ranked is open only after level 10; other PvP modes keep their own floors. */
export const RANKED_MIN_LEVEL = 11;

export const RANKED_LEVEL_WARNING = `Reach level ${RANKED_MIN_LEVEL} to enter ranked battles.`;

export function rankedLevelEligible(level: unknown): level is number {
    return typeof level === 'number' && Number.isSafeInteger(level) && level >= RANKED_MIN_LEVEL;
}
