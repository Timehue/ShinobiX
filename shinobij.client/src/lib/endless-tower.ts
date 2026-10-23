/*
 * Endless / Celestial Tower scaling + reward math.
 *
 *   • endlessScaleFactor          — per-wave opponent difficulty multiplier
 *   • endlessWaveReward           — ryo banked per wave
 *   • endlessTowerMilestoneReward — the currency table for every 5th-kill milestone
 * These helpers are display-only previews. Opponent choice/scaling and every
 * economy mutation are authoritative in api/endless.
 */

// Economy rebalance (2026-10) dial defaults, mirrored from api/endless/_run.ts
// and pinned equal by scripts/endless-wave-parity.test.ts. They stay literals
// here (no shared import) because this module is in App's eager graph.
/** Wave pay stops scaling at this wave; opponent difficulty does not. */
export const ENDLESS_FACTOR_CAP_WAVE = 20;
/** The level term of the wave pay uses min(level, this). */
export const ENDLESS_LEVEL_CAP = 70;
/** Final multiplier on the wave pay. */
export const ENDLESS_REWARD_MULT = 0.55;
/** The server pays Fate Shard milestones only on a wave beyond the account's best. */
export const ENDLESS_FS_LIFETIME_FIRST = true;
/** The server pays Bone Charm milestones only on the free first run of the UTC day. */
export const ENDLESS_BC_FIRST_RUN_OF_DAY = true;

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
    // Pay uses the capped factor; the difficulty curve above stays uncapped.
    const factor = endlessScaleFactor(Math.min(Math.max(1, wave), ENDLESS_FACTOR_CAP_WAVE));
    const level = Math.min(ENDLESS_LEVEL_CAP, Math.max(1, Math.floor(Number(playerLevel) || 0)));
    const baseRyo = 40 + level * 6;
    const isMilestone = wave % 5 === 0;
    const milestoneBonus = isMilestone ? (wave % 10 === 0 ? 3 : 2) : 1;
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (15 + level·2) folds into banked ryo at ~0.75:1 — mirrors api/endless/_run.ts.
    // `xp` stays in the shape as 0 for older saves' run objects.
    const raw = Math.floor(baseRyo * factor * milestoneBonus) + Math.floor((15 + level * 2) * factor * milestoneBonus * 0.75);
    return {
        ryo: Math.floor(raw * ENDLESS_REWARD_MULT),
        xp: 0,
        isMilestone,
    };
}

// Celestial Tower kill-milestone table. Every 5 kills the player can
// earn shop currencies on top of the per-wave ryo banking. Pattern
// cycles every 20 kills:
//   pos 0 (waves 5,  25, 45 …): 5 Bone Charms
//   pos 1 (waves 10, 30, 50 …): 5 Bone Charms
//   pos 2 (waves 15, 35, 55 …): 5 Fate Shards
//   pos 3 (waves 20, 40, 60 …): 5 Bone Charms + 5 Fate Shards
// Non-multiples of 5 return zero. This is the table only: the server pays
// Fate Shards only past the account's best wave (ENDLESS_FS_LIFETIME_FIRST)
// and Bone Charms only on the day's free run (ENDLESS_BC_FIRST_RUN_OF_DAY),
// and it alone credits the reward.
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
