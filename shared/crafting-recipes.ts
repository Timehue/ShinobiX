import { GATHER_NAMES, GATHER_RECIPE_INGREDIENTS } from './gathering-materials.js';
import { RESOURCE_ITEMS, resourceItemId, RESOURCE_GRADES, type ResourceFamily, type ResourceGrade } from './resource-items.js';
import { resourceForgeRequirement } from './resource-forging.js';
import { HUNT_MATERIAL_SELL_RYO } from './hunt-material-sale.js';
import { FUEL_IDS } from './cooking-recipes.js';
import { WEEKLY_BOSS_CORE_ID } from './stacked-materials.js';
import { RARITY_LEVEL_FLOOR } from './item-level-gate.js';

/** Each row is required; IDs within a row are interchangeable, lowest-first. */
export type CraftIngredient = { ids: readonly string[]; count: number; label: string };
/** One exact quantity map per required ingredient row. */
export type CraftMaterialSelection = ReadonlyArray<Readonly<Record<string, number>>>;
export type SupplyCraftRecipe = {
    ingredients: readonly CraftIngredient[];
    count?: number;
    currency?: 'auraDust' | 'boneCharms';
    amount?: number;
    levelReq?: number;
};

export const CRAFT_MATERIAL_NAMES: Readonly<Record<string, string>> = {
    ...GATHER_NAMES,
    ...Object.fromEntries(RESOURCE_ITEMS.map(item => [item.id, item.name])),
    'hunt-torn-hide': 'Torn Hide', 'hunt-wild-feather': 'Wild Feather',
    'hunt-small-fang': 'Small Fang', 'hunt-cracked-horn': 'Cracked Horn',
    'hunt-beast-meat': 'Beast Meat', 'hunt-frost-pelt': 'Frost Pelt',
    'hunt-shadow-claw': 'Shadow Claw', 'hunt-wolf-fang': 'Wolf Fang',
    'hunt-ash-scale': 'Ash Scale', 'hunt-ember-scale': 'Ember Scale',
    'hunt-shadow-pelt': 'Shadow Pelt', 'hunt-ancient-beast-core': 'Ancient Beast Core',
    'hunt-titan-bone': 'Titan Bone', 'hunt-legendary-material': 'Legendary Material',
    'dungeon-legendary-relic': 'Dungeon Legendary Relic',
    'warforged-relic': 'Warforged Relic', 'veil-of-the-hollow': 'Veil of the Hollow',
    'weekly-boss-core': 'Weekly Boss Core',
    'ration-pack': 'Ration Pack', 'pet-treat': 'Pet Treat', 'elemental-pet-treat': 'Elemental Treats',
};
export const craftMaterialName = (id: string) => CRAFT_MATERIAL_NAMES[id] ?? id;
const material = (id: string, count: number): CraftIngredient => ({ ids: [id], count, label: craftMaterialName(id) });
const choice = (ids: readonly string[], count: number, label?: string): CraftIngredient => ({
    ids, count, label: label ?? ids.map(craftMaterialName).join(' / '),
});
const exact = (id: string) => Object.entries(GATHER_RECIPE_INGREDIENTS[id] ?? {}).map(([id, count]) => material(id, count));
export function gradedCraftMaterial(family: ResourceFamily, grade: ResourceGrade, count: number): CraftIngredient {
    return choice(RESOURCE_GRADES.slice(grade).map((_, index) => resourceItemId(family, (grade + index) as ResourceGrade)), count,
        `${craftMaterialName(resourceItemId(family, grade))}${grade < 3 ? ' or better' : ''}`);
}
const fiber = (count: number) => material('gather-binding-fiber', count);
const herb = (count: number) => material('gather-field-herb', count);
const bark = (count: number) => material('gather-heartwood-bark', count);
const thread = (count: number) => material('gather-shadow-thread', count);
const feather = (count: number) => material('hunt-wild-feather', count);
const hide = (count: number) => choice(['hunt-torn-hide', 'hunt-frost-pelt', 'hunt-shadow-pelt'], count);
const fang = (count: number) => choice(['hunt-small-fang', 'hunt-wolf-fang', 'hunt-shadow-claw'], count);
const scale = (count: number) => choice(['hunt-ash-scale', 'hunt-ember-scale'], count, 'Ash / Ember Scale');
const iron = (count: number, grade: ResourceGrade = 0) => gradedCraftMaterial('gather-iron-sand', grade, count);
// 2026-10 rebalance, item-use pass. Each substitute stands in 1:1 and comes
// LAST in its row, so the planner keeps spending the original material first
// and a craft never costs more than before.
// Forge fuel: Common Ember Ore and Ember Scale burn like Heartwood Bark
// (shared/cooking-recipes.ts FUEL_IDS, the same row the Noodle Den uses).
const fuel = (count: number) => choice(FUEL_IDS, count, 'Heartwood Bark or Ember fuel');
// Shadow Pelt (two per Moon Serpent hunt, and the hide row spends Torn Hide
// first) stands in for the trace-only Shadow Thread.
const threadOrPelt = (count: number) => choice(['gather-shadow-thread', 'hunt-shadow-pelt'], count, 'Shadow Thread / Shadow Pelt');
// One S-rank trophy row: each apex hunt drops only one of core or bone, so
// either (or a Legendary Material) builds every repeatable pet recipe. The
// recipe's original trophy leads; Legendary Material is always last.
const trophy = (count: number, first: 'hunt-ancient-beast-core' | 'hunt-titan-bone' = 'hunt-ancient-beast-core') =>
    choice([first, first === 'hunt-titan-bone' ? 'hunt-ancient-beast-core' : 'hunt-titan-bone', 'hunt-legendary-material'], count);
// Every grade of River Fish feeds the pet food recipes, not only Common.
const petFoodBase = (count: number) => choice(['hunt-beast-meat', ...RESOURCE_GRADES.map((_, grade) => resourceItemId('gather-river-fish', grade as ResourceGrade))], count, 'Beast Meat / River Fish (any grade)');
const petFoodMinerals = (count: number, minGrade: ResourceGrade = 0) => choice(
    RESOURCE_GRADES.slice(minGrade).flatMap((_, index) =>
        (['gather-rime-crystal', 'gather-ember-ore', 'gather-stormglass-shard'] as const)
            .map(id => resourceItemId(id, (minGrade + index) as ResourceGrade))),
    count, `${RESOURCE_GRADES[minGrade]} or better Rime Crystal / Ember Ore / Stormglass Shard`,
);

/** Equipment carries bulk ore costs. Regional traces are rare (2% on a mining
 * success), so everyday medicines accept Common minerals and advanced gear
 * uses small quantities of graded catalysts. Exact selections protect quality. */
export const SUPPLY_CRAFT_RECIPES: Readonly<Record<string, SupplyCraftRecipe>> = {
    'village-supply-bundle': { ingredients: exact('village-supply-bundle') },
    'village-supply-crate': { ingredients: exact('village-supply-crate') },
    'pet-treat': { ingredients: [petFoodBase(4), herb(2)] },
    'elemental-pet-treat': { ingredients: [material('pet-treat', 2), petFoodMinerals(4), herb(4)] },
    'ancient-pet-treat': { ingredients: [material('elemental-pet-treat', 1), petFoodBase(8), herb(8), petFoodMinerals(2, 1)] },
    'beast-seal-master': { ingredients: [gradedCraftMaterial('gather-stormglass-shard', 1, 4), bark(4), threadOrPelt(4), fiber(8)], levelReq: 30 },
    'currency:aura-dust': { ingredients: [gradedCraftMaterial('gather-stormglass-shard', 0, 2), herb(4), fiber(2)], currency: 'auraDust', amount: 50 },
    'currency:bone-charm': { ingredients: [material('hunt-cracked-horn', 6), material('hunt-small-fang', 4), fiber(4), gradedCraftMaterial('gather-stormglass-shard', 0, 1)], currency: 'boneCharms', amount: 1 },
    // Fuel feeds the forge; fiber ties the finished throwing tools into bundles.
    // A combat consumable equips into a character slot, which the rarity ladder
    // gates (shared/item-level-gate.ts), so its recipe opens at that same level:
    // a Lv1-29 crafter used to make Lv30 consumables they could only sell (2026-10
    // item-use pass). The Shuriken is common, so its recipe stays open.
    'thrown-shuriken': { ingredients: [iron(6), fuel(1), fiber(2)], count: 3 },
    'thrown-senbon': { ingredients: [iron(3, 1), fuel(1), fiber(2)], levelReq: RARITY_LEVEL_FLOOR.rare },
    'thrown-serpent-dust': { ingredients: [herb(6), threadOrPelt(1), feather(2)], levelReq: RARITY_LEVEL_FLOOR.rare },
    'item-smoke-bomb': { ingredients: [bark(1), herb(4), fiber(2)], levelReq: RARITY_LEVEL_FLOOR.rare },
    'item-attack-pill': { ingredients: [herb(4), material('hunt-beast-meat', 2), bark(1)], levelReq: RARITY_LEVEL_FLOOR.rare },
    'item-defense-pill': { ingredients: [herb(4), material('hunt-cracked-horn', 2), bark(1)], levelReq: RARITY_LEVEL_FLOOR.rare },
    'potion-rejuvenation': { ingredients: [herb(10), gradedCraftMaterial('gather-rime-crystal', 0, 2), bark(1)], levelReq: RARITY_LEVEL_FLOOR.rare },
    'pve-hunters-bond-harness': { ingredients: [hide(12), fiber(8), iron(6, 1)] },
    'pve-loyal-companion-bell': { ingredients: [iron(8, 1), fiber(6), gradedCraftMaterial('gather-stormglass-shard', 1, 1)] },
    'pve-frenzy-claw': { ingredients: [material('hunt-shadow-claw', 8), iron(8, 1), fiber(6)] },
    'pve-guardians-blessing': { ingredients: [scale(8), gradedCraftMaterial('gather-rime-crystal', 1, 1), fiber(6)] },
    'pve-sanguine-charm': { ingredients: [fang(10), trophy(2), fiber(6)] },
    'pve-predators-fang': { ingredients: [material('hunt-wolf-fang', 8), iron(6, 2), fiber(6)] },
    'pve-avengers-pendant': { ingredients: [iron(8, 2), gradedCraftMaterial('gather-ember-ore', 1, 1), fiber(6)] },
    'pve-bloodbond-totem': { ingredients: [bark(4), trophy(3), threadOrPelt(2), fiber(6)] },
    'pve-pack-alpha-crest': { ingredients: [material('hunt-frost-pelt', 8), material('hunt-wolf-fang', 6), iron(8, 2), fiber(8)] },
    'pve-apex-predator-fang': { ingredients: [trophy(4, 'hunt-titan-bone'), material('hunt-shadow-claw', 8), iron(10, 2), fiber(8)] },
    'consum-phantom-charm': { ingredients: [threadOrPelt(1), feather(3), fiber(3)] },
    'consum-smoke-pellet': { ingredients: [bark(1), herb(6), fiber(3)] },
    'consum-cleansing-incense': { ingredients: [herb(6), bark(1), fiber(2)] },
    'consum-thornmail-oil': { ingredients: [herb(5), material('hunt-beast-meat', 2), scale(3)] },
    'consum-lifeline-elixir': { ingredients: [herb(8), gradedCraftMaterial('gather-rime-crystal', 0, 2), bark(1)] },
    'consum-second-wind': { ingredients: [herb(8), trophy(1), feather(3)] },
};

/*
 * NPC buy-back cap for crafted goods (2026-10 economy rebalance, framework 2.11 /
 * 5.1, #33). A supply recipe charged no ryo then (it pays the shared/craft-fees.ts
 * fee now) and its outputs used to sell for half
 * their catalog cost, so crafting turned unsellable gathered materials, and hunt
 * materials at 1.65-17x their own sale price, into ryo. A crafted good now sells
 * for at most 7/10 of the cheapest NPC value its recipe accepts, so crafting to
 * sell is always worse than selling the inputs raw. A recipe made only of
 * gathered materials (which have no NPC price) sells for nothing. Both sale
 * routes and the Inventory preview price through standardSaleUnitValue.
 */
export const CRAFTED_SALE_INPUT_NUM = 7;
export const CRAFTED_SALE_INPUT_DEN = 10;
/** Crafted intermediates are valued through their own recipe this many levels deep. */
const CRAFTED_SALE_MAX_DEPTH = 2;

function npcUnitValue(id: string, depth: number): number {
    if (Object.hasOwn(HUNT_MATERIAL_SELL_RYO, id)) return HUNT_MATERIAL_SELL_RYO[id];
    if (depth < CRAFTED_SALE_MAX_DEPTH && Object.hasOwn(SUPPLY_CRAFT_RECIPES, id)) return craftedCap(id, depth + 1) ?? 0;
    // Gathered and graded materials, rations and relics have no NPC price.
    return 0;
}

function craftedCap(itemId: string, depth: number): number | null {
    if (!Object.hasOwn(SUPPLY_CRAFT_RECIPES, itemId)) return null;
    const recipe = SUPPLY_CRAFT_RECIPES[itemId];
    if (recipe.currency) return null; // a currency recipe makes no item
    // Ids in a row are interchangeable, and the player can always pay with the cheapest.
    const inputs = recipe.ingredients.reduce((sum, row) =>
        sum + row.count * Math.min(...row.ids.map((id) => npcUnitValue(id, depth))), 0);
    return Math.floor((inputs * CRAFTED_SALE_INPUT_NUM) / (CRAFTED_SALE_INPUT_DEN * (recipe.count ?? 1)));
}

/** Per-unit NPC cap for a crafted good; null when the item has no supply recipe. */
export function craftedSaleCapRyo(itemId: string): number | null {
    return craftedCap(itemId, 0);
}

/** The standard NPC unit price, floor(cost / 2), capped for crafted goods. 0 means unsellable. */
export function standardSaleUnitValue(itemId: string, cost: number): number {
    const half = Math.floor(Math.max(0, Number(cost) || 0) / 2);
    const cap = craftedSaleCapRyo(itemId);
    return cap == null ? half : Math.min(half, cap);
}

export type CraftableGear = { id: string; slot: string; rarity: string; weaponEp?: number; armorQuality?: string };
export function gearCraftIngredients(item: CraftableGear): CraftIngredient[] {
    const ore = resourceForgeRequirement(item);
    if (!ore) return [];
    const weapon = item.slot === 'hand' && item.weaponEp != null;
    const ingredients: CraftIngredient[] = [{ ids: ore.ids, count: ore.count, label: ore.label }];
    if (weapon) {
        ingredients.push(fuel(2), fiber((ore.grade + 1) * 2));
        // The Elderbranch is carved from the wood itself, so it keeps exact bark.
        if (item.id === 'elderbranch-katana') ingredients[1] = bark(4);
        if (item.id === 'black-lotus-dagger') ingredients.push(thread(3));
        if (item.id === 'frostfang-oathblade') ingredients.push(gradedCraftMaterial('gather-rime-crystal', 2, 2));
        if (item.id === 'embercoil-scythe') ingredients.push(gradedCraftMaterial('gather-ember-ore', 2, 2));
        if (item.id === 'tempest-fang-blade') ingredients.push(gradedCraftMaterial('gather-stormglass-shard', 2, 2));
        // The Weekly Boss Core is "used to forge epic and legendary weapons": it
        // stands in, last in each row, for the epic catalyst or the legendary relic.
        if (item.rarity === 'epic') {
            const catalyst = gradedCraftMaterial('gather-stormglass-shard', 1, 1);
            ingredients.push(choice([...catalyst.ids, WEEKLY_BOSS_CORE_ID], 1, `${catalyst.label}, or a Weekly Boss Core`));
        }
        if (item.rarity === 'legendary') ingredients.push(choice(['dungeon-legendary-relic', 'warforged-relic', 'veil-of-the-hollow', WEEKLY_BOSS_CORE_ID], 1, 'Dungeon / Warforged / Hollow relic or Weekly Boss Core'));
    } else {
        // Leather lining, ties and metal reinforcement scale with the piece's size.
        // The Crafter forges Rare armor only (api/craft/_forge.ts), and every
        // Rare piece takes the shared hide row, which already accepts Frost and
        // Shadow Pelt.
        const size = item.slot === 'body' ? 8 : item.slot === 'legs' ? 6 : 4;
        ingredients.push(hide(size), fiber(item.slot === 'body' ? 6 : item.slot === 'legs' ? 4 : 3));
    }
    return ingredients;
}

/** Reserve a complete batch before mutating inventory; shared by server and UI. */
export function planCraftIngredients(ingredients: readonly CraftIngredient[], owned: (id: string) => number, quantity = 1): Record<string, number> | null {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;
    const spent: Record<string, number> = {};
    for (const ingredient of ingredients) {
        let remaining = ingredient.count * quantity;
        for (const id of ingredient.ids) {
            const available = Math.max(0, Math.floor(owned(id)) - (spent[id] ?? 0));
            const take = Math.min(remaining, available);
            if (take > 0) spent[id] = (spent[id] ?? 0) + take;
            remaining -= take;
        }
        if (remaining > 0) return null;
    }
    return spent;
}

/** Validate the player's complete selection without substituting any material. */
export function planSelectedCraftIngredients(ingredients: readonly CraftIngredient[], owned: (id: string) => number, quantity: number, selection: unknown): Record<string, number> | null {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !Array.isArray(selection) || selection.length !== ingredients.length) return null;
    const spent: Record<string, number> = {};
    for (let index = 0; index < ingredients.length; index++) {
        const row: unknown = selection[index];
        const ingredient = ingredients[index];
        if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
        const entries = Object.entries(row);
        if (entries.length > ingredient.ids.length) return null;
        let total = 0;
        for (const [id, amount] of entries) {
            if (!ingredient.ids.includes(id) || !Number.isSafeInteger(amount) || amount < 0) return null;
            total += amount;
            spent[id] = (spent[id] ?? 0) + amount;
            if (spent[id] > owned(id)) return null;
        }
        if (total !== ingredient.count * quantity) return null;
    }
    return spent;
}

export function craftIngredientProgress(ingredients: readonly CraftIngredient[], owned: (id: string) => number, quantity = 1): number {
    const required = ingredients.reduce((sum, ingredient) => sum + ingredient.count * quantity, 0);
    if (!required) return 0;
    const have = ingredients.reduce((sum, ingredient) => sum + Math.min(ingredient.count * quantity, ingredient.ids.reduce((n, id) => n + owned(id), 0)), 0);
    return Math.min(100, Math.floor(have / required * 100));
}
