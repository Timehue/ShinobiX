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
    const isMilestone = wave % 5 === 0;
    const milestoneBonus = isMilestone ? (wave % 10 === 0 ? 3 : 2) : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (15 + level·2) folds into banked ryo at ~0.75:1 — mirrors api/endless/_run.ts.
    // `xp` stays in the shape as 0 for older saves' run objects.
    return {
        ryo: Math.floor(baseRyo * factor * milestoneBonus) + Math.floor((15 + playerLevel * 2) * factor * milestoneBonus * 0.75),
        xp: 0,
        isMilestone,
    };
}

// Cash out a finished tower run onto the character. XP is retired, and with it
// the whole daily-XP-softcap subsystem: waves bank ryo only. A legacy in-flight
// run (started before the cutover) may still carry bankedXp — convert it at the
// same ~0.75:1 fold as the wave rewards so nobody's active run is voided.
// `gainXp` (now the derived-level recompute shim) is injected to keep this
// module free of an App import cycle.
export function applyTowerCashOut(
    character: Character,
    run: EndlessTowerRun,
    todayKey: string,
    gainXp: (c: Character, amount: number) => Character,
): Character {
    void todayKey; // retained in the signature for call-site stability
    const legacyXpAsRyo = Math.floor(Math.max(0, Math.floor(run.bankedXp)) * 0.75);
    const leveled = gainXp(character, 0);
    return {
        ...leveled,
        ryo: (leveled.ryo ?? 0) + run.bankedRyo + legacyXpAsRyo,
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
