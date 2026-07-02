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

// Server-authoritative base PvP-win reward summary, returned by
// /api/pvp/claim-rewards (mirrors creditPvpWinBase's summary in
// api/_xp-engine.ts). When the server credits a win, the client applies THESE
// values rather than recomputing locally — so the server-side repeat-opponent
// decay (PvP audit #1) sticks instead of being clobbered by the client's own
// grant on the next save flush.
export type PvpWinBaseSummary = {
    ryo: number;
    xp: number;
    level: number;
    rankTitle: string;
    maxHp: number;
    maxChakra: number;
    maxStamina: number;
    unspentStats: number;
    // Serious (non-ranked) PvP combat-use stat growth. The pool share is already in
    // `unspentStats`; `allocated` is the per-stat auto-growth the client adds on top
    // via applyStatGrowth (server wrote the same delta, so no double-count/clobber).
    statGrowth?: { allocated: Partial<Record<string, number>>; unspentGain: number };
};

// Apply a server-credited base reward onto the local character, replacing the
// progression fields (xp / level / rank title / pool maxes / unspent stats /
// ryo) with the server's authoritative post-credit values. Current pools are
// refilled to the new maxes ONLY when the win produced a level-up — mirroring
// App.tsx's gainXp, which sets hp/chakra/stamina to the new max on each level
// gained and otherwise leaves them untouched. Every other character field is
// preserved so the caller can still layer its client-only extras (territory
// scrolls, auraDust, kill counters, war bounty) on top.
export function applyServerBaseReward(character: Character, base: PvpWinBaseSummary): Character {
    const leveledUp = base.level > (character.level ?? 0);
    return {
        ...character,
        xp: base.xp,
        level: base.level,
        maxHp: base.maxHp,
        maxChakra: base.maxChakra,
        maxStamina: base.maxStamina,
        unspentStats: base.unspentStats,
        ryo: base.ryo,
        ...(base.rankTitle ? { rankTitle: base.rankTitle } : {}),
        ...(leveledUp ? { hp: base.maxHp, chakra: base.maxChakra, stamina: base.maxStamina } : {}),
    };
}
