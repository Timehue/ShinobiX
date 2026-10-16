import { craftMaterialName, planCraftIngredients, type CraftIngredient } from './crafting-recipes.js';
import { resourceItemId, type ResourceFamily, type ResourceGrade } from './resource-items.js';

/*
 * What ONE named-gear roll costs, besides its Fate Shards
 * (shared/named-forge-economy.ts). Owner ruling 2026-10-15: the price is paid
 * to ROLL, and every roll is kept — there is no discard and no re-roll. An
 * unwanted piece is sold on the Sunscar Exchange (unequipped named gear is
 * listable). Rolling used to be free and only the final forge charged, so a
 * player could re-roll until a perfect piece and pay once.
 *
 * Named gear sits above legendary, so a roll draws on the end of every
 * gathering line: Pristine ore, the apex-hunt materials (the level-70
 * Ancient Chakra Beast and Worldstorm Dragon hunts each drop 2 Legendary
 * Material plus a Core or a Titan Bone), a Superior elemental catalyst, and one
 * relic from dungeons, war crates or the Hollow Gate. Every number lives here.
 */

const exact = (id: string, count: number): CraftIngredient => ({ ids: [id], count, label: craftMaterialName(id) });
const either = (ids: readonly string[], count: number, label: string): CraftIngredient => ({ ids, count, label });

const ELEMENTAL_FAMILIES: readonly ResourceFamily[] = ['gather-rime-crystal', 'gather-ember-ore', 'gather-stormglass-shard'] as ResourceFamily[];
/** Superior or Pristine grade of any elemental mineral, lowest grade spent first. */
const elementalCatalyst = (count: number): CraftIngredient => either(
    ([2, 3] as ResourceGrade[]).flatMap((grade) => ELEMENTAL_FAMILIES.map((family) => resourceItemId(family, grade))),
    count,
    'Superior Rime Crystal / Ember Ore / Stormglass (or better)',
);
const relic = (count: number): CraftIngredient => either(
    ['dungeon-legendary-relic', 'warforged-relic', 'veil-of-the-hollow'],
    count,
    'Dungeon / Warforged / Hollow relic',
);

export const NAMED_FORGE_PRISTINE_ORE = 'gather-iron-sand-pristine';

export function namedForgeIngredients(kind: 'weapon' | 'armor'): CraftIngredient[] {
    return kind === 'weapon'
        ? [
            exact(NAMED_FORGE_PRISTINE_ORE, 20),
            exact('hunt-legendary-material', 2),
            exact('hunt-titan-bone', 1),
            exact('hunt-ancient-beast-core', 1),
            elementalCatalyst(2),
            relic(1),
        ]
        : [
            exact(NAMED_FORGE_PRISTINE_ORE, 16),
            exact('hunt-legendary-material', 2),
            exact('hunt-shadow-pelt', 4),
            exact('hunt-ancient-beast-core', 1),
            elementalCatalyst(2),
            relic(1),
        ];
}

/** The exact items one roll would spend, or null when something is short. */
export function planNamedForgeMaterials(kind: 'weapon' | 'armor', owned: (id: string) => number): Record<string, number> | null {
    return planCraftIngredients(namedForgeIngredients(kind), owned, 1);
}

/** The first ingredient row the player is short on, for a precise refusal. */
export function namedForgeShortfall(kind: 'weapon' | 'armor', owned: (id: string) => number): CraftIngredient | null {
    for (const ingredient of namedForgeIngredients(kind)) {
        const have = ingredient.ids.reduce((sum, id) => sum + Math.max(0, Math.floor(owned(id))), 0);
        if (have < ingredient.count) return ingredient;
    }
    return null;
}
