import { anchorRyoPerMinute, ECONOMY_ANCHOR_CAP } from './economy-anchor.js';

/** Pet Gauntlet ryo, anchored to A(L) (2026-10 economy rebalance, owner ruling
 * 2026-10-23).
 *
 * At L70+ (A = 300) a run pays the original schedule: 250 a cleared round and
 * 1,500 for clearing all ten, so 4,000 a full clear and 12,000 across the three
 * rewarded runs a day. Below L70 the round pay, the clear bonus and the paid
 * entry fee all scale with A(L), so an L10 full clear pays 800 instead of 4,000
 * and a paid entry costs 300. The fee scales too, so a low-level player's second
 * and third runs stay worth entering. `start` seals the schedule, so levelling
 * mid-run does not change it.
 *
 * Shared by server and client so the entry quote never drifts from the debit. */
export const PET_GAUNTLET_RYO_PER_ROUND_AT_CAP = 250;
export const PET_GAUNTLET_CLEAR_BONUS_AT_CAP = 1_500;
export const PET_GAUNTLET_ENTRY_FEE_AT_CAP = 1_500;

export type PetGauntletRyoSchedule = { perRound: number; clearBonus: number; entryFee: number };

export function petGauntletRyoSchedule(level: unknown): PetGauntletRyoSchedule {
    const share = anchorRyoPerMinute(Number(level)) / ECONOMY_ANCHOR_CAP;
    return {
        perRound: Math.round(PET_GAUNTLET_RYO_PER_ROUND_AT_CAP * share),
        clearBonus: Math.round(PET_GAUNTLET_CLEAR_BONUS_AT_CAP * share),
        entryFee: Math.round(PET_GAUNTLET_ENTRY_FEE_AT_CAP * share),
    };
}
