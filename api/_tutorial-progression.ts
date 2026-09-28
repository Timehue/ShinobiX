import { applyDerivedLevel, earnedForLevel, earnedStatPoints } from './_xp-engine.js';

export const ACADEMY_LEVEL_FLOORS = {
    training: 2,
    spar: 2,
    trial: 6,
    graduation: 10,
} as const;

/** Add only the shortfall needed to reach an Academy checkpoint's level. */
export function grantAcademyLevelFloor(
    character: Record<string, unknown>,
    targetLevel: number,
): { character: Record<string, unknown>; statPoints: number } {
    const level = Math.max(1, Math.floor(Number(targetLevel) || 1));
    const shortfall = Math.max(0, earnedForLevel(level) - earnedStatPoints(character));
    const withShortfall = shortfall > 0
        ? {
            ...character,
            unspentStats: Math.max(0, Math.floor(Number(character.unspentStats) || 0)) + shortfall,
        }
        : character;
    return {
        character: applyDerivedLevel(withShortfall),
        statPoints: shortfall,
    };
}
