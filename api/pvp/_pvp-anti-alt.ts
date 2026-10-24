/*
 * The two anti-alt rules every PvP payout shares, in one dependency-free
 * module so the casual purse (api/pvp/_valid-fight.ts), Vanguard Honor Seals
 * (api/pvp/_vanguard-rewards.ts, which re-exports these names), the sleeper KO
 * and the legacy PvP-win report cannot drift apart when one of them is tuned.
 */

/** A loser younger than this pays nothing to the winner (fresh-alt guard). */
export const ACCOUNT_AGE_MIN_MS = 72 * 60 * 60 * 1000;

/** A winner more than this many levels above the loser is stomping: no credit. */
export const PVP_CREDIT_LEVEL_GAP_MAX = 20;

export function levelGapMult(attackerLevel: number, opponentLevel: number): number {
    const gap = attackerLevel - opponentLevel;
    if (gap > PVP_CREDIT_LEVEL_GAP_MAX) return 0;
    if (gap > 10) return 0.5;
    return 1;
}
