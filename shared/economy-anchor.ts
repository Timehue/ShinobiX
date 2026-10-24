/** The economy anchor (2026-10 rebalance, docs/economy-rebalance-2026-10.md).
 *
 * A(L) is the ryo one active minute of standard play is worth at level L. Every
 * re-anchored repeatable payout (PvP purse, war purse, Hollow Gate / Rift level
 * scale, wanderer favours, war MVP) is sized as a multiple of it, so one curve
 * moves them together. It stops rising at L70 so endgame per-minute pay
 * plateaus while prices that scale with it stay reachable.
 *
 * Shared by server and client so previews never drift from the payout. */
export const ECONOMY_ANCHOR_BASE = 20;
export const ECONOMY_ANCHOR_PER_LEVEL = 4;
export const ECONOMY_ANCHOR_CAP = 300;
export const ECONOMY_ANCHOR_MAX_LEVEL = 100;

function normalizedLevel(level: number): number {
    if (!Number.isFinite(level)) return 1;
    return Math.min(ECONOMY_ANCHOR_MAX_LEVEL, Math.max(1, Math.floor(level)));
}

/** A(L) = min(300, 20 + 4L) ryo per active minute. */
export function anchorRyoPerMinute(level: number): number {
    return Math.min(ECONOMY_ANCHOR_CAP, ECONOMY_ANCHOR_BASE + ECONOMY_ANCHOR_PER_LEVEL * normalizedLevel(level));
}
