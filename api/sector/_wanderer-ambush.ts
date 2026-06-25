/*
 * Pure logic for the sector-wanderer AMBUSH boss reward
 * (api/sector/wanderer-ambush.ts). Unit-testable without KV / auth / locks.
 *
 * Clearing an ambush (3 robbers + a boss) is hard and gated behind a 5-streak, so
 * the boss "drop" is bigger than a daily gift — but it stays forge-resistant: the
 * baseline foe-kill count is sealed in KV at ambush START, and CLAIM only pays if
 * the player has actually won AMBUSH_KILLS_REQUIRED more fights since (i.e. cleared
 * the gauntlet). The reward is rolled SERVER-SIDE and the claim is daily-capped.
 */

export const AMBUSH_KILLS_REQUIRED = 4;     // 3 robbers + 1 boss
export const AMBUSH_REWARDS_PER_DAY = 3;    // cap on paid ambush clears / UTC day

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

export interface AmbushReward {
    ryo: number;
    fateShards: number;
    boneCharms: number;
}

/** Boss-clear loot: a decent ryo range + 1–3 fate shards + 5–10 bone charms. */
export function rollAmbushReward(level: number, rng: () => number): AmbushReward {
    const lvl = clamp(level, 1, 100);
    const ryoBase = 150 + lvl * 12;                       // L50≈750, L100≈1350
    return {
        ryo: Math.round(ryoBase * (0.8 + rng() * 0.6)),  // ≈0.8×–1.4× of base
        fateShards: 1 + Math.floor(rng() * 3),           // 1–3
        boneCharms: 5 + Math.floor(rng() * 6),           // 5–10
    };
}

/** True once the player has won AMBUSH_KILLS_REQUIRED fights since the sealed baseline. */
export function ambushCleared(baseline: number, current: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= AMBUSH_KILLS_REQUIRED;
}
