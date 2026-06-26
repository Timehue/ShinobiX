"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WANDERER_GIFT_FATE_SHARD_CHANCE = exports.WANDERER_GIFTS_PER_DAY = void 0;
exports.rollWandererGift = rollWandererGift;
exports.decideWandererGift = decideWandererGift;
exports.WANDERER_GIFTS_PER_DAY = 3;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));
/** Chance a gift includes a single fate shard. */
exports.WANDERER_GIFT_FATE_SHARD_CHANCE = 0.25;
/** Roll a gift bundle. ryo is a small level-scaled range; an occasional 1 fate
 *  shard; 1–5 bone charms. */
function rollWandererGift(level, rng) {
    const lvl = clamp(level, 1, 100);
    const ryoBase = 30 + lvl * 5; // L1≈35, L50≈280, L100≈530
    return {
        ryo: Math.round(ryoBase * (0.6 + rng() * 0.9)), // ≈0.6×–1.5× of base
        fateShards: rng() < exports.WANDERER_GIFT_FATE_SHARD_CHANCE ? 1 : 0, // sometimes 1
        boneCharms: 1 + Math.floor(rng() * 5), // 1–5
    };
}
/** `claimsSoFar` = gifts already taken today, BEFORE this one. */
function decideWandererGift(claimsSoFar) {
    if (claimsSoFar >= exports.WANDERER_GIFTS_PER_DAY)
        return { ok: false, reason: "daily-cap" };
    return { ok: true };
}
