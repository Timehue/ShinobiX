/*
 * Village Stores material points per donated unit: the ONE table behind the
 * server's api/craft/_forge.ts CRAFT_POINTS and the Town Hall's mirror
 * (shinobij.client/src/lib/village-stores.ts CRAFT_POINT_VALUES). Each side
 * builds it from its own copy of the same item catalog, so the two can only
 * differ if the catalogs do (scripts/village-stores-parity.test.ts pins them).
 *
 * The 2026-10 rebalance item-use pass (owner ruling A11) adds two exits for
 * items that had none besides the NPC:
 *   - non-story relics, 50 points per relic tier. A duplicate relic grant already
 *     pays Fate Shards, so this is the outlet for one the player has outgrown.
 *   - gear step drops, 50 / 75 / 100 points for tier 0 / 1 / 2. Step drops keep
 *     coming from the highest unlocked tier, capped at tier 2, so an endgame
 *     player receives steps that are all worse than what they wear.
 * A donation's Village Merit stays at the item's NPC sale value
 * (api/village/_donation-merit.ts), so neither change is a merit source.
 */
import { NON_STORY_RELICS } from './relics.js';
import { gearTierOf, isStepItemId } from './gear-steps.js';

/** Hunt materials, the Weekly Boss Core and the three forge relics. */
export const MATERIAL_CRAFT_POINTS: Readonly<Record<string, number>> = {
    'hunt-torn-hide': 3, 'hunt-wild-feather': 3, 'hunt-small-fang': 3, 'hunt-cracked-horn': 3,
    'hunt-beast-meat': 5, 'hunt-frost-pelt': 8, 'hunt-shadow-claw': 8, 'hunt-wolf-fang': 10,
    'hunt-ash-scale': 15, 'hunt-ember-scale': 20, 'hunt-shadow-pelt': 25,
    'hunt-ancient-beast-core': 30, 'hunt-titan-bone': 30, 'hunt-legendary-material': 50,
    'weekly-boss-core': 150, 'dungeon-legendary-relic': 200, 'warforged-relic': 250, 'veil-of-the-hollow': 250,
};

/** Material points per tier of an equippable non-story relic (tier 1-6: 50-300). */
export const RELIC_CRAFT_POINTS_PER_TIER = 50;

/** Material points for a gear step drop, by its tier (0 common/Standard, 1 rare/Reinforced, 2 epic/Rare). */
export const GEAR_STEP_CRAFT_POINTS_BY_TIER: readonly number[] = [50, 75, 100];

type CatalogEntry = { id: string; slot: string; rarity: string; weaponEp?: number; armorQuality?: string };

/** The full points table for one side's item catalog (step ids come from it). */
export function buildCraftPointTable(catalog: Iterable<CatalogEntry>): Record<string, number> {
    const table: Record<string, number> = { ...MATERIAL_CRAFT_POINTS };
    for (const relic of NON_STORY_RELICS) table[relic.id] = RELIC_CRAFT_POINTS_PER_TIER * relic.tier;
    for (const item of catalog) {
        if (!isStepItemId(item.id)) continue;
        const tier = gearTierOf(item)?.tier;
        const points = tier == null ? 0 : GEAR_STEP_CRAFT_POINTS_BY_TIER[tier] ?? 0;
        if (points > 0) table[item.id] = points;
    }
    return table;
}
