/*
 * Pure decision logic for the sector-wanderer GIFT (api/sector/wanderer-gift.ts),
 * split out so the reward math + daily cap can be unit-tested without KV / auth /
 * locks (same pattern as api/pvp/_bounty.ts).
 *
 * Conservative + daily-capped by design: a small, mildly level-scaled ryo gift at
 * or below a normal PvE win, so wanderers can't become a ryo faucet. The amount
 * is recomputed server-side (never trusted from the client) and bounded by the
 * per-day cap — so the worst case is "claim your few daily wanderer gifts".
 */

export const WANDERER_GIFTS_PER_DAY = 3;

/** Small, mildly level-scaled ryo gift. Tunable. */
export function wandererGiftRyo(level: number): number {
    const lvl = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
    return 40 + lvl * 8; // L1≈48, L50≈440, L100≈840 — modest, below typical PvE payouts
}

export type GiftDecision = { ok: true; ryo: number } | { ok: false; reason: "daily-cap" };

/** `claimsSoFar` = gifts already taken today, BEFORE this one. */
export function decideWandererGift(level: number, claimsSoFar: number): GiftDecision {
    if (claimsSoFar >= WANDERER_GIFTS_PER_DAY) return { ok: false, reason: "daily-cap" };
    return { ok: true, ryo: wandererGiftRyo(level) };
}
