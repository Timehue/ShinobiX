// Rarity-tiered sale values for unbuyable (cost:0) hunt materials, roughly
// tracking each material's forge craft-point worth (~x10). Ownership,
// sellability, cost normalization, and settlement remain with the callers.
export const HUNT_MATERIAL_SELL_RYO: Record<string, number> = {
    'hunt-torn-hide': 12, 'hunt-wild-feather': 12, 'hunt-small-fang': 12, 'hunt-cracked-horn': 12,
    'hunt-beast-meat': 15, 'hunt-frost-pelt': 40, 'hunt-shadow-claw': 40, 'hunt-wolf-fang': 55,
    'hunt-ash-scale': 80, 'hunt-ember-scale': 180, 'hunt-shadow-pelt': 220,
    'hunt-ancient-beast-core': 450, 'hunt-titan-bone': 450, 'hunt-legendary-material': 600,
};
