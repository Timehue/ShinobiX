/*
 * Endless / Celestial Tower scaling + reward math.
 *
 *   • endlessScaleFactor          — per-wave difficulty/reward multiplier
 *   • endlessWaveReward           — ryo/xp banked per wave
 *   • endlessTowerMilestoneReward — currency drops on every 5th-kill milestone
 *
 * Pure numeric functions, no dependencies. Extracted from App.tsx (Region A).
 */

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
