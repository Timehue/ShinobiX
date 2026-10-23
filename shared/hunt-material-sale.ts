// Rarity-tiered sale values for unbuyable (cost:0) hunt materials, roughly
// tracking each material's forge craft-point worth (~x10). The top five entries
// (ember scale and up) were trimmed x0.8 in the 2026-10 economy rebalance (#20):
// at L70+ they made hunt materials worth 1,650 ryo a hunt, more than the hunt's
// own contract pay. The release audit still measured L70+ hunts at about 1.7 x A
// through material sales, so the owner cut the top three again (2026-10-23):
// Ancient Beast Core and Titan Bone 360 -> 200, Legendary Material 480 -> 240.
// The lower tiers carry the early-game hunt income and stay. Ownership,
// sellability, cost normalization, and settlement remain with the callers.
export const HUNT_MATERIAL_SELL_RYO: Record<string, number> = {
    'hunt-torn-hide': 12, 'hunt-wild-feather': 12, 'hunt-small-fang': 12, 'hunt-cracked-horn': 12,
    'hunt-beast-meat': 15, 'hunt-frost-pelt': 40, 'hunt-shadow-claw': 40, 'hunt-wolf-fang': 55,
    'hunt-ash-scale': 80, 'hunt-ember-scale': 144, 'hunt-shadow-pelt': 176,
    'hunt-ancient-beast-core': 200, 'hunt-titan-bone': 200, 'hunt-legendary-material': 240,
};
