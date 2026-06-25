/*
 * Pure decision logic for the sector-wanderer GIFT (api/sector/wanderer-gift.ts),
 * split out so the roll + daily cap can be unit-tested without KV / auth / locks
 * (same pattern as api/pvp/_bounty.ts).
 *
 * A gift is a small random BUNDLE: a modest ryo amount, an OCCASIONAL single fate
 * shard, and 1–5 bone charms. The amounts are rolled SERVER-SIDE (never trusted
 * from the client) and bounded by the per-day cap, so wanderers stay a fun
 * trickle, not a faucet. `rollWandererGift` takes an rng so the math is
 * deterministic in tests.
 */

export const WANDERER_GIFTS_PER_DAY = 3;

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

export interface GiftBundle {
    ryo: number;
    fateShards: number;
    boneCharms: number;
}

/** Chance a gift includes a single fate shard. */
export const WANDERER_GIFT_FATE_SHARD_CHANCE = 0.25;

/** Roll a gift bundle. ryo is a small level-scaled range; an occasional 1 fate
 *  shard; 1–5 bone charms. */
export function rollWandererGift(level: number, rng: () => number): GiftBundle {
    const lvl = clamp(level, 1, 100);
    const ryoBase = 30 + lvl * 5;                            // L1≈35, L50≈280, L100≈530
    return {
        ryo: Math.round(ryoBase * (0.6 + rng() * 0.9)),     // ≈0.6×–1.5× of base
        fateShards: rng() < WANDERER_GIFT_FATE_SHARD_CHANCE ? 1 : 0, // sometimes 1
        boneCharms: 1 + Math.floor(rng() * 5),              // 1–5
    };
}

export type GiftDecision = { ok: true } | { ok: false; reason: "daily-cap" };

/** `claimsSoFar` = gifts already taken today, BEFORE this one. */
export function decideWandererGift(claimsSoFar: number): GiftDecision {
    if (claimsSoFar >= WANDERER_GIFTS_PER_DAY) return { ok: false, reason: "daily-cap" };
    return { ok: true };
}
