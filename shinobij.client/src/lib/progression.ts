/*
 * Character progression helpers — XP-gain formulas and ranked-rating
 * Elo math. Pure functions; the larger `gainXp` driver that calls these
 * (and chains level-up effects) stays in App.tsx for now because it
 * touches many other App-scope helpers (xpNeeded, maxHpForLevel,
 * reconcileCharacterStatBudget, etc.) that haven't been extracted yet.
 *
 * Extracted from App.tsx.
 */

import type { Character } from "../types/character";
import { CHARACTER_XP_GAIN_MULTIPLIER } from "../constants/game";

// XP gained by a character for a given base amount, including the
// global testing-phase multiplier and the +10% Elder training-focus
// bonus when the character's village elder is set to "training".
export function effectiveCharacterXpGain(
    character: Pick<Character, "elderFocus">,
    amount: number,
): number {
    const baseAmount = Math.max(0, Math.floor(amount));
    const testingBoostedAmount = Math.floor(baseAmount * CHARACTER_XP_GAIN_MULTIPLIER);
    const trainingFocusBonus = character.elderFocus === "training"
        ? Math.floor(testingBoostedAmount * 0.1)
        : 0;
    return testingBoostedAmount + trainingFocusBonus;
}

// Variant for UI labels — applies the elder-focus bonus when a character
// is supplied, otherwise just the testing-phase multiplier. Used by
// "Reward: X XP" displays that may or may not have a character in scope.
export function displayCharacterXpGain(
    amount: number,
    character?: Pick<Character, "elderFocus">,
): number {
    return character
        ? effectiveCharacterXpGain(character, amount)
        : Math.floor(Math.max(0, amount) * CHARACTER_XP_GAIN_MULTIPLIER);
}

// Standard ELO-style ranked rating delta. Returns the amount the winner
// gains (loser loses the same). K-factor = 24, floor = 8 so even big
// upsets give the winner something to show for it.
export function rankedDelta(winnerRating: number, loserRating: number): number {
    const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    return Math.max(8, Math.round(24 * (1 - expected)));
}
