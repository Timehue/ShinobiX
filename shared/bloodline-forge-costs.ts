/**
 * What a Bloodline Awakening ritual costs, per rank. The server debits these
 * (api/bloodlines/_forge.ts) and the Awakening Stone screen quotes them, so a
 * price change reaches both from this one table.
 */
export const BLOODLINE_FORGE_RANKS = ['B Rank', 'A Rank', 'S Rank'] as const;
export type BloodlineForgeRank = typeof BLOODLINE_FORGE_RANKS[number];
export type BloodlineForgeCurrency = 'boneCharms' | 'auraStones' | 'mythicSeals';

/** 2026-10 economy rebalance (framework 3.2, #16): B costs 3-5 regular days of
 *  Bone Charms (200, was 100). A and S are unchanged, and S stays locked. */
export const BLOODLINE_FORGE_COSTS: Readonly<Record<BloodlineForgeRank, Readonly<{ currency: BloodlineForgeCurrency; cost: number }>>> = {
    'B Rank': { currency: 'boneCharms', cost: 200 },
    'A Rank': { currency: 'auraStones', cost: 100 },
    'S Rank': { currency: 'mythicSeals', cost: 100 },
};
