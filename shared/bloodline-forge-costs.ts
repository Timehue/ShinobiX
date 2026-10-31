/**
 * What a Bloodline Awakening ritual costs, per rank. The server debits these
 * (api/bloodlines/_forge.ts) and the Awakening Stone screen quotes them, so a
 * price change reaches both from this one table.
 */
export const BLOODLINE_FORGE_RANKS = ['B Rank', 'A Rank', 'S Rank'] as const;
export type BloodlineForgeRank = typeof BLOODLINE_FORGE_RANKS[number];
export type BloodlineForgeCurrency = 'boneCharms' | 'auraStones' | 'mythicSeals';

/** B-rank awakening costs 100 Bone Charms; each higher rank uses its own material. */
export const BLOODLINE_FORGE_COSTS: Readonly<Record<BloodlineForgeRank, Readonly<{ currency: BloodlineForgeCurrency; cost: number }>>> = {
    'B Rank': { currency: 'boneCharms', cost: 100 },
    'A Rank': { currency: 'auraStones', cost: 100 },
    'S Rank': { currency: 'mythicSeals', cost: 100 },
};
