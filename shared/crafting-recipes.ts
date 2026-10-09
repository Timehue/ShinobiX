import { GATHER_NAMES, GATHER_RECIPE_INGREDIENTS } from './gathering-materials.js';
import { RESOURCE_ITEMS, resourceItemId, RESOURCE_GRADES, type ResourceFamily, type ResourceGrade } from './resource-items.js';
import { resourceForgeRequirement } from './resource-forging.js';

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
    'hunt-titan-bone': 'Titan Bone', 'dungeon-legendary-relic': 'Dungeon Legendary Relic',
    'warforged-relic': 'Warforged Relic', 'veil-of-the-hollow': 'Veil of the Hollow',
    'ration-pack': 'Ration Pack', 'pet-treat': 'Pet Treat',
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
const core = (count: number) => material('hunt-ancient-beast-core', count);
const iron = (count: number, grade: ResourceGrade = 0) => gradedCraftMaterial('gather-iron-sand', grade, count);

/** Equipment carries bulk ore costs. Regional traces are rare (2% on a mining
 * success), so everyday medicines accept Common minerals and advanced gear
 * uses small quantities of graded catalysts. Exact selections protect quality. */
export const SUPPLY_CRAFT_RECIPES: Readonly<Record<string, SupplyCraftRecipe>> = {
    'village-supply-bundle': { ingredients: exact('village-supply-bundle') },
    'village-supply-crate': { ingredients: exact('village-supply-crate') },
    'pet-treat': { ingredients: [choice(['hunt-beast-meat', 'gather-river-fish'], 4), herb(2)] },
    'elemental-pet-treat': { ingredients: [material('pet-treat', 2), choice(['gather-rime-crystal', 'gather-ember-ore', 'gather-stormglass-shard'], 2), herb(1)] },
    'beast-seal-master': { ingredients: [gradedCraftMaterial('gather-stormglass-shard', 1, 4), bark(4), thread(4), fiber(8)], levelReq: 30 },
    'currency:aura-dust': { ingredients: [gradedCraftMaterial('gather-stormglass-shard', 0, 2), herb(4), fiber(2)], currency: 'auraDust', amount: 50 },
    'currency:bone-charm': { ingredients: [material('hunt-cracked-horn', 6), material('hunt-small-fang', 4), fiber(4), gradedCraftMaterial('gather-stormglass-shard', 0, 1)], currency: 'boneCharms', amount: 1 },
    // Bark fuels the forge; fiber ties the finished throwing tools into bundles.
    'thrown-shuriken': { ingredients: [iron(6), bark(1), fiber(2)], count: 3 },
    'thrown-senbon': { ingredients: [iron(3, 1), bark(1), fiber(2)] },
    'thrown-serpent-dust': { ingredients: [herb(6), thread(1), feather(2)] },
    'item-smoke-bomb': { ingredients: [bark(1), herb(4), fiber(2)] },
    'item-attack-pill': { ingredients: [herb(4), material('hunt-beast-meat', 2), bark(1)] },
    'item-defense-pill': { ingredients: [herb(4), material('hunt-cracked-horn', 2), bark(1)] },
    'potion-rejuvenation': { ingredients: [herb(10), gradedCraftMaterial('gather-rime-crystal', 0, 2), bark(1)] },
    'pve-hunters-bond-harness': { ingredients: [hide(12), fiber(8), iron(6, 1)] },
    'pve-loyal-companion-bell': { ingredients: [iron(8, 1), fiber(6), gradedCraftMaterial('gather-stormglass-shard', 1, 1)] },
    'pve-frenzy-claw': { ingredients: [material('hunt-shadow-claw', 8), iron(8, 1), fiber(6)] },
    'pve-guardians-blessing': { ingredients: [scale(8), gradedCraftMaterial('gather-rime-crystal', 1, 1), fiber(6)] },
    'pve-sanguine-charm': { ingredients: [fang(10), core(2), fiber(6)] },
    'pve-predators-fang': { ingredients: [material('hunt-wolf-fang', 8), iron(6, 2), fiber(6)] },
    'pve-avengers-pendant': { ingredients: [iron(8, 2), gradedCraftMaterial('gather-ember-ore', 1, 1), fiber(6)] },
    'pve-bloodbond-totem': { ingredients: [bark(4), core(3), thread(2), fiber(6)] },
    'pve-pack-alpha-crest': { ingredients: [material('hunt-frost-pelt', 8), material('hunt-wolf-fang', 6), iron(8, 2), fiber(8)] },
    'pve-apex-predator-fang': { ingredients: [material('hunt-titan-bone', 4), material('hunt-shadow-claw', 8), iron(10, 2), fiber(8)] },
    'consum-phantom-charm': { ingredients: [thread(1), feather(3), fiber(3)] },
    'consum-smoke-pellet': { ingredients: [bark(1), herb(6), fiber(3)] },
    'consum-cleansing-incense': { ingredients: [herb(6), bark(1), fiber(2)] },
    'consum-thornmail-oil': { ingredients: [herb(5), material('hunt-beast-meat', 2), scale(3)] },
    'consum-lifeline-elixir': { ingredients: [herb(8), gradedCraftMaterial('gather-rime-crystal', 0, 2), bark(1)] },
    'consum-second-wind': { ingredients: [herb(8), core(1), feather(3)] },
};

export type CraftableGear = { id: string; slot: string; rarity: string; weaponEp?: number; armorQuality?: string };
export function gearCraftIngredients(item: CraftableGear): CraftIngredient[] {
    const ore = resourceForgeRequirement(item);
    if (!ore) return [];
    const weapon = item.slot === 'hand' && item.weaponEp != null;
    const ingredients: CraftIngredient[] = [{ ids: ore.ids, count: ore.count, label: ore.label }];
    if (weapon) {
        ingredients.push(bark(2), fiber((ore.grade + 1) * 2));
        if (item.id === 'elderbranch-katana') ingredients[1] = bark(4);
        if (item.id === 'black-lotus-dagger') ingredients.push(thread(3));
        if (item.id === 'frostfang-oathblade') ingredients.push(gradedCraftMaterial('gather-rime-crystal', 2, 2));
        if (item.id === 'embercoil-scythe') ingredients.push(gradedCraftMaterial('gather-ember-ore', 2, 2));
        if (item.id === 'tempest-fang-blade') ingredients.push(gradedCraftMaterial('gather-stormglass-shard', 2, 2));
        if (item.rarity === 'epic') ingredients.push(gradedCraftMaterial('gather-stormglass-shard', 1, 1));
        if (item.rarity === 'legendary') ingredients.push(choice(['dungeon-legendary-relic', 'warforged-relic', 'veil-of-the-hollow'], 1, 'Dungeon / Warforged / Hollow relic'));
    } else {
        // Leather lining, ties and metal reinforcement scale with the piece's size.
        const size = item.slot === 'body' ? 8 : item.slot === 'legs' ? 6 : 4;
        ingredients.push(hide(size), fiber(item.slot === 'body' ? 6 : item.slot === 'legs' ? 4 : 3));
        if (item.id.includes('frost') || item.id.includes('snow')) ingredients[1] = material('hunt-frost-pelt', size);
        if (item.id.includes('shadow')) ingredients[1] = material('hunt-shadow-pelt', size);
        if (item.id.includes('ember') || item.id.includes('ash')) ingredients.push(scale(2));
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
