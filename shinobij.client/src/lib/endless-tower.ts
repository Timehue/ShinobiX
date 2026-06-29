/*
 * Endless / Celestial Tower scaling + reward math.
 *
 *   • endlessScaleFactor          — per-wave difficulty/reward multiplier
 *   • endlessWaveReward           — ryo/xp banked per wave
 *   • endlessTowerMilestoneReward — currency drops on every 5th-kill milestone
 *
 * Pure numeric functions (plus applyTowerCashOut, type-only Character dep + an
 * injected gainXp). Extracted from App.tsx (Region A).
 */
import type { Character, EndlessTowerRun } from "../types/character";

// Endless Tower scaling — wave 1 is baseline; each wave adds a small multiplier,
// with milestone jumps every 5 and 10 waves.
export function endlessScaleFactor(wave: number): number {
    const w = Math.max(1, wave);
    const base = 1 + (w - 1) * 0.08;
    const fives = Math.floor(w / 5) * 0.10;
    const tens = Math.floor(w / 10) * 0.15;
    return Math.max(1, base + fives + tens);
}

export function endlessWaveReward(wave: number, playerLevel: number): { ryo: number; xp: number; isMilestone: boolean } {
    const factor = endlessScaleFactor(wave);
    const baseRyo = 40 + playerLevel * 6;
    const baseXp = 15 + playerLevel * 2;
    const isMilestone = wave % 5 === 0;
    const milestoneBonus = isMilestone ? (wave % 10 === 0 ? 3 : 2) : 1;
    return {
        ryo: Math.floor(baseRyo * factor * milestoneBonus),
        xp: Math.floor(baseXp * factor * milestoneBonus),
        isMilestone,
    };
}

// ── Daily character-XP soft-cap (progression redesign Phase 2) ──────────────
// The tower is the one UNCAPPED, compounding character-XP faucet, so a grinder
// could blow past the ~90-day level curve. We keep the tower a great ryo/material
// farm but bound its CHARACTER-XP contribution per day: full rate up to a soft cap
// (~half a daily-active player's modeled income D(L)=120·L+900), then sharply
// diminished beyond it. Ryo/material drops are NOT capped. The `dailyTowerXp`
// counter (raw, pre-decay) resets daily like the other daily counters. These are
// STARTING values — tune from playtests.
export const TOWER_XP_DAILY_SOFTCAP_BASE = 450;
export const TOWER_XP_DAILY_SOFTCAP_PER_LEVEL = 60; // 60·L + 450 ≈ 0.5 × D(L)
export const TOWER_XP_OVERCAP_FACTOR = 0.2; // XP beyond the soft cap is worth 20%

export function towerDailyXpSoftCap(level: number): number {
    const lvl = Math.max(1, Math.floor(level || 1));
    return TOWER_XP_DAILY_SOFTCAP_BASE + lvl * TOWER_XP_DAILY_SOFTCAP_PER_LEVEL;
}

// Given a run's banked (raw) tower XP, how much already earned from the tower
// today, and the player's level, return the XP to actually credit (full under the
// soft cap, decayed above it). `rawEarned` is what to add to the daily counter
// (always the raw banked amount, so the cap tracks gross earning).
export function creditTowerXpWithSoftCap(banked: number, earnedToday: number, level: number): { credited: number; rawEarned: number } {
    const raw = Math.max(0, Math.floor(banked));
    const cap = towerDailyXpSoftCap(level);
    const room = Math.max(0, cap - Math.max(0, Math.floor(earnedToday)));
    const under = Math.min(raw, room);
    const over = raw - under;
    return { credited: under + Math.floor(over * TOWER_XP_OVERCAP_FACTOR), rawEarned: raw };
}

// Cash out a finished tower run onto the character. Credits banked XP through the
// injected `gainXp` (so it levels up + reconciles the stat budget + respects the
// exam gate — a raw xp+= would be clamped away by the new, smaller xpNeeded curve)
// after the daily soft cap, banks the ryo uncapped, advances the daily tower-XP
// counter, and clears the run. `gainXp` is injected to keep this module free of an
// App import cycle.
export function applyTowerCashOut(
    character: Character,
    run: EndlessTowerRun,
    todayKey: string,
    gainXp: (c: Character, amount: number) => Character,
): Character {
    const towerXpToday = character.lastDailyReset === todayKey ? (character.dailyTowerXp ?? 0) : 0;
    const { credited } = creditTowerXpWithSoftCap(run.bankedXp, towerXpToday, character.level ?? 1);
    const leveled = gainXp(character, credited);
    return {
        ...leveled,
        ryo: (leveled.ryo ?? 0) + run.bankedRyo,
        dailyTowerXp: towerXpToday + Math.max(0, Math.floor(run.bankedXp)),
        lastDailyReset: todayKey,
        endlessTowerBestWave: Math.max(leveled.endlessTowerBestWave ?? 0, run.wave),
        endlessTowerRun: null,
    };
}

// Celestial Tower kill-milestone rewards. Every 5 kills the player
// earns guaranteed shop currencies on top of the per-wave ryo/xp
// banking. Pattern cycles every 20 kills:
//   pos 0 (waves 5,  25, 45 …): 5 Bone Charms
//   pos 1 (waves 10, 30, 50 …): 5 Bone Charms
//   pos 2 (waves 15, 35, 55 …): 5 Fate Shards
//   pos 3 (waves 20, 40, 60 …): 5 Bone Charms + 5 Fate Shards
// Non-multiples of 5 return zero. Helper is pure data, called by
// handleEndlessWin in the wave-bump path so a death-clear still
// keeps everything already credited to the player's character.
export function endlessTowerMilestoneReward(wave: number): { boneCharms: number; fateShards: number } {
    if (wave <= 0 || wave % 5 !== 0) return { boneCharms: 0, fateShards: 0 };
    const cyclePos = (Math.floor(wave / 5) - 1) % 4;
    switch (cyclePos) {
        case 0:
        case 1:
            return { boneCharms: 5, fateShards: 0 };
        case 2:
            return { boneCharms: 0, fateShards: 5 };
        case 3:
            return { boneCharms: 5, fateShards: 5 };
        default:
            return { boneCharms: 0, fateShards: 0 };
    }
}
