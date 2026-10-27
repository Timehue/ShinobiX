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
 *  - Supplies: about a quarter of what the shop charges for the whole batch
 *    (price x output count), so crafting stays cheaper than buying but is never
 *    free. Goods the shop does not sell are priced against what they replace.
 *
 * The numbers are written out, not derived, so a change shows up in review;
 * shared/craft-fees.test.ts holds each one to its shop price.
 * The server charges it in api/craft/_forge.ts and the Crafter UI shows it from
 * here, so the two cannot disagree.
 */
import { VILLAGE_SUPPLY_GOODS } from './gathering-supplies.js';

export const GEAR_CRAFT_RYO = { rare: 24_000, epic: 56_000, legendary: 140_000 } as const;

/** The fee for one gear craft. Rare, epic, and everything above it pays the legendary rate. */
export function gearCraftRyo(rarity: string): number {
    if (rarity === 'rare') return GEAR_CRAFT_RYO.rare;
    if (rarity === 'epic') return GEAR_CRAFT_RYO.epic;
    return GEAR_CRAFT_RYO.legendary;
}

/** Fee per craft (one batch of the recipe's output), by recipe id. The Village
 *  supply goods keep their own fee in shared/gathering-supplies.ts. */
export const SUPPLY_CRAFT_RYO: Readonly<Record<string, number>> = {
    'pet-treat': 400,
    'elemental-pet-treat': 1_000,
    'ancient-pet-treat': 2_000,
    'beast-seal-master': 8_000,
    'currency:aura-dust': 1_500,
    'currency:bone-charm': 2_500,
    'thrown-shuriken': 1_200,
    'thrown-senbon': 150,
    'thrown-serpent-dust': 400,
    'item-smoke-bomb': 360,
    'item-attack-pill': 320,
    'item-defense-pill': 320,
    'potion-rejuvenation': 1_800,
    'pve-hunters-bond-harness': 3_600,
    'pve-loyal-companion-bell': 3_600,
    'pve-frenzy-claw': 4_200,
    'pve-guardians-blessing': 4_200,
    'pve-sanguine-charm': 4_800,
    'pve-predators-fang': 5_400,
    'pve-avengers-pendant': 3_000,
    'pve-bloodbond-totem': 6_000,
    'pve-pack-alpha-crest': 6_600,
    'pve-apex-predator-fang': 7_200,
    'consum-phantom-charm': 960,
    'consum-smoke-pellet': 600,
    'consum-cleansing-incense': 1_120,
    'consum-thornmail-oil': 1_280,
    'consum-lifeline-elixir': 1_440,
    'consum-second-wind': 1_600,
};

/** The fee for one craft of a supply recipe; 0 for an id with no recipe. */
export function supplyCraftRyo(recipeId: string): number {
    if (Object.hasOwn(VILLAGE_SUPPLY_GOODS, recipeId)) return VILLAGE_SUPPLY_GOODS[recipeId].ryo;
    return Object.hasOwn(SUPPLY_CRAFT_RYO, recipeId) ? SUPPLY_CRAFT_RYO[recipeId] : 0;
}
