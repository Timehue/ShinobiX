/**
 * Profession combat bonuses — drained verbatim out of App.tsx (lines 774-898).
 *
 * Pure functions over a Character: the Pet Tamer multipliers, Vanguard Honor
 * Seal accounting, and the profession XP-to-rank curve. None of them touched
 * component state, and App itself called none of them — every consumer reached
 * them through the `"../App"` surface, which App still re-exports, so no call
 * site moves.
 *
 * Moving them here also makes them testable for the first time: App.tsx imports
 * a .webp, so node:test cannot load it, which is why this logic shipped with no
 * direct coverage. See ./profession-bonuses.test.ts.
 *
 * This is a MOVE, not a rewrite — the bodies below are byte-identical to the
 * block that lived in App.tsx. Note that src/professionLogic.ts keeps its own
 * parallel implementations with different signatures (it takes profession+rank
 * where these take a Character); that duplication predates this drain and is
 * deliberately left alone.
 */
import type { Character } from "../types/character";
import type { Profession } from "../types/core";
import {
    ANTI_ALT_ACCOUNT_AGE_MS,
    PROFESSION_MAX_RANK,
    PROFESSION_XP_BASELINE,
    PROFESSION_XP_HEALER,
    VANGUARD_DAILY_SEAL_CAP,
    VANGUARD_PER_TARGET_DAILY_CAP,
    VANGUARD_SEALS_PER_KILL,
} from "../constants/profession";
import { masteryBonus } from "./profession-mastery";
import { levelGapSealMultiplier } from "../professionLogic";

// ── Profession combat bonuses ────────────────────────────────────────────
// Pet Tamer PvE pet damage mult (+5% unlock, +1.5%/rank, +Savagery mastery); PvE only.
export function petTamerPveMultiplier(character: Character | null | undefined): number {
    if (!character || character.profession !== "petTamer") return 1;
    const rank = Math.max(0, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    // Unlock = +5%; rank 1 = +6.5%; rank 10 = +20%.
    const bonusPct = 5 + rank * 1.5 + masteryBonus(character, "petPveDamagePct");
    return 1 + bonusPct / 100;
}

// VANGUARD_SEALS_PER_KILL / VANGUARD_DAILY_SEAL_CAP /
// VANGUARD_PER_TARGET_DAILY_CAP moved to ./constants/profession.

// Vanguard XP per PvP kill: 100 base + 10 per target level above 30.
export function vanguardXpForKill(opponent: Character | null | undefined): number {
    if (!opponent) return 0;
    const lvl = Number(opponent.level ?? 1);
    return 100 + 10 * Math.max(0, lvl - 30);
}

// ANTI_ALT_ACCOUNT_AGE_MS moved to ./constants/profession.
function targetTooYoungForRewards(opponent: Character | null | undefined): boolean {
    if (!opponent?.createdAt) return false;
    return (Date.now() - opponent.createdAt) < ANTI_ALT_ACCOUNT_AGE_MS;
}

// levelGapSealMultiplier (the docs/professions.md anti-abuse table: within 10
// levels = full reward; 10-20 below = 50%; >20 below = 0) is imported from
// ../professionLogic rather than kept here. App.tsx used to hold a
// byte-identical copy, and main deduplicated it on the grounds that two copies
// of a reward table is how they drift. Re-declaring it here would have restored
// exactly the duplication that change removed.

// Pet Tamer Phase 2 bonuses (client-side). Training speed % faster, expedition
// reward multiplier, daily First Expedition 2x flag.
export function petTamerTrainingSpeedPct(character: Character | null | undefined): number {
    if (!character || character.profession !== "petTamer") return 0;
    const rank = Math.max(0, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    // Unlock 10%; +1%/rank to 20% at L10; +Drill Sergeant mastery (PvE/utility).
    return 10 + rank + masteryBonus(character, "petTrainTimePct");
}

export function petTamerExpeditionMult(character: Character | null | undefined): number {
    if (!character || character.profession !== "petTamer") return 1;
    const rank = Math.max(0, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    // Unlock +10%; +1.5% per rank to +25% at rank 10.
    return 1 + (10 + rank * 1.5) / 100;
}

// Returns true if this is the first expedition the player has claimed today
// (UTC). Updates `lastExpeditionClaimDate` and `expeditionsClaimedToday` on
// the returned character.
export function petTamerClaimFirstExpeditionToday(character: Character, todayKey: string): { isFirst: boolean; nextCharacter: Character } {
    const sameDay = character.lastExpeditionClaimDate === todayKey;
    const count = sameDay ? (character.expeditionsClaimedToday ?? 0) : 0;
    const isFirst = character.profession === "petTamer" && count === 0;
    return {
        isFirst,
        nextCharacter: {
            ...character,
            lastExpeditionClaimDate: todayKey,
            expeditionsClaimedToday: count + 1,
        },
    };
}

// Compute Honor Seals earned for a PvP kill given Vanguard rank, level gap,
// daily cap, and per-target cap. Returns {amount, byTarget} where byTarget is
// the new count for that target today.
export function vanguardSealsForKill(
    killer: Character,
    opponent: Character,
    todayKey: string,
): { amount: number; updatedByTarget: Record<string, number> } {
    if (killer.profession !== "vanguard") return { amount: 0, updatedByTarget: killer.dailyHonorSealsByTarget ?? {} };

    // Anti-alt: zero rewards for targets whose account is brand new.
    if (targetTooYoungForRewards(opponent)) {
        return { amount: 0, updatedByTarget: killer.dailyHonorSealsByTarget ?? {} };
    }

    const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, killer.professionRank ?? 1));
    const baseSeals = VANGUARD_SEALS_PER_KILL[rank];

    const gapMult = levelGapSealMultiplier(killer.level, opponent.level);
    let amount = Math.floor(baseSeals * gapMult);
    if (amount <= 0) return { amount: 0, updatedByTarget: killer.dailyHonorSealsByTarget ?? {} };

    // Daily cap.
    const todayActive = killer.vanguardDailyResetDate === todayKey;
    const dailySoFar = todayActive ? (killer.dailyHonorSealsEarned ?? 0) : 0;
    const remainingDaily = Math.max(0, VANGUARD_DAILY_SEAL_CAP - dailySoFar);
    amount = Math.min(amount, remainingDaily);

    // Per-target daily cap.
    const byTarget = todayActive ? (killer.dailyHonorSealsByTarget ?? {}) : {};
    const targetName = opponent.name.toLowerCase();
    const targetSoFar = byTarget[targetName] ?? 0;
    const remainingForTarget = Math.max(0, VANGUARD_PER_TARGET_DAILY_CAP - targetSoFar);
    amount = Math.min(amount, remainingForTarget);

    if (amount <= 0) return { amount: 0, updatedByTarget: byTarget };

    const updatedByTarget = { ...byTarget, [targetName]: targetSoFar + amount };
    return { amount, updatedByTarget };
}

// PROFESSION_XP_BASELINE / PROFESSION_XP_HEALER / PROFESSION_MAX_RANK
// moved to ./constants/profession.

export function professionThresholds(profession: Profession): readonly number[] {
    return profession === "healer" ? PROFESSION_XP_HEALER : PROFESSION_XP_BASELINE;
}

export function getProfessionRankForXp(profession: Profession, xp: number): number {
    const t = professionThresholds(profession);
    let rank = 1;
    for (let i = 1; i <= PROFESSION_MAX_RANK; i += 1) {
        if (xp >= t[i]) rank = i + 1;
    }
    return Math.min(PROFESSION_MAX_RANK, rank);
}
