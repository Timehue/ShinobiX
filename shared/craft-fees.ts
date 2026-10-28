/*
 * Crafter ryo fees (2026-10-27 economy pass).
 *
 * Gear crafts always charged a ryo fee. Supply crafts charged none (bar the two
 * Village supply goods), so a player could turn gathered materials into
 * consumables for free while the shop priced the same goods in the thousands.
 * Both now charge a fee that sits beside the shop price:
 *
 *  - Gear: a fee per rarity, scaled with the shelf prices in shop-pricing.ts
 *    (rare 24,000 is the top of the Reinforced armor shelf; each tier up is
 *    roughly 2.3-2.5x the one below). The materials are on top of the fee.
 *  - Supplies: a quarter of what the shop charges for the whole batch (shelf
 *    price x output count), so crafting stays cheaper than buying but is never
 *    free. Goods the shop does not sell are priced by hand below.
 *
 * The server charges it in api/craft/_forge.ts and the Crafter UI shows it from
 * here, so the two cannot disagree. shared/craft-fees.test.ts pins both. This
 * file ships in the client bundle (tight size budget), so it is kept small.
 */
import { VILLAGE_SUPPLY_GOODS } from './gathering-supplies.js';

export const GEAR_CRAFT_RYO = { rare: 24_000, epic: 56_000, legendary: 140_000 } as const;

/** The fee for one gear craft. Rare and epic have their own; everything above pays the legendary rate. */
export const gearCraftRyo = (rarity: string): number => GEAR_CRAFT_RYO[rarity as 'rare'] ?? GEAR_CRAFT_RYO.legendary;

/** Fee per craft for supply goods with no shelf price (Crafter-only), by recipe id. */
export const SUPPLY_CRAFT_RYO: Readonly<Record<string, number>> = {
    'elemental-pet-treat': 1_000,
    'ancient-pet-treat': 2_000,
    'beast-seal-master': 8_000,
    'currency:aura-dust': 1_500,
    'currency:bone-charm': 2_500,
};

/**
 * The fee for one craft of a supply recipe. `shelfCost` is the output's shop
 * price (0 when it is not sold) and `outputCount` how many one craft makes.
 * The Village supply goods keep their own fee in shared/gathering-supplies.ts.
 */
export function supplyCraftRyo(recipeId: string, shelfCost = 0, outputCount = 1): number {
    if (Object.hasOwn(VILLAGE_SUPPLY_GOODS, recipeId)) return VILLAGE_SUPPLY_GOODS[recipeId].ryo;
    if (Object.hasOwn(SUPPLY_CRAFT_RYO, recipeId)) return SUPPLY_CRAFT_RYO[recipeId];
    return Math.floor(shelfCost * outputCount / 4); // a quarter of the batch's shelf price
}
