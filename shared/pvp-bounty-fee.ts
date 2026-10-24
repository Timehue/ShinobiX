/**
 * Bounty posting fee (2026-10 rebalance #30). Placing a bounty escrows the
 * stake on the head and burns a 15% posting fee on top, so the board is a ryo
 * sink rather than a pure transfer. Shared by the server (api/pvp/_bounty.ts)
 * and the Bounty Board panel so the quoted cost never drifts from the charge.
 */
export const BOUNTY_PLACEMENT_FEE_RATE = 0.15;
const FEE_PERCENT = 15;

/** The fee burned on a stake: 15%, rounded down (1,000 -> 150). */
export function bountyPlacementFee(amount: number): number {
    const stake = Math.floor(Number(amount));
    if (!Number.isFinite(stake) || stake <= 0) return 0;
    return Math.floor((stake * FEE_PERCENT) / 100);
}

/** Stake plus fee: what the placer is charged. */
export function bountyPlacementTotal(amount: number): number {
    const stake = Math.max(0, Math.floor(Number(amount) || 0));
    return stake + bountyPlacementFee(stake);
}
