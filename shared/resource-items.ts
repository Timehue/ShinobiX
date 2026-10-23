/** Static item identities. Catalog consumers need no gathering simulation code. */
export type ResourceActivity = 'fishing' | 'mining';
export const RESOURCE_GRADES = ['Common', 'Fine', 'Superior', 'Pristine'] as const;
export type ResourceGrade = 0 | 1 | 2 | 3;
export const RESOURCE_FAMILIES = {
    'gather-river-fish': { name: 'River Fish', activity: 'fishing' },
    'gather-iron-sand': { name: 'Iron Sand', activity: 'mining' },
    'gather-rime-crystal': { name: 'Rime Crystal', activity: 'mining' },
    'gather-ember-ore': { name: 'Ember Ore', activity: 'mining' },
    'gather-stormglass-shard': { name: 'Stormglass Shard', activity: 'mining' },
} as const;
export type ResourceFamily = keyof typeof RESOURCE_FAMILIES;
export const resourceItemId = (family: ResourceFamily, grade: ResourceGrade) => grade === 0 ? family : `${family}-${RESOURCE_GRADES[grade].toLowerCase()}`;

const RARITY_LADDER = ['common', 'uncommon', 'rare', 'epic'] as const;
export type ResourceRarity = typeof RARITY_LADDER[number];
/** The catalog rarity of each family's Common grade: the regional traces are rare. */
const FAMILY_BASE_RARITY: Readonly<Record<ResourceFamily, ResourceRarity>> = {
    'gather-river-fish': 'common', 'gather-iron-sand': 'common',
    'gather-rime-crystal': 'rare', 'gather-ember-ore': 'rare', 'gather-stormglass-shard': 'rare',
};
/**
 * Display rarity of a graded resource: one ladder step per grade (Common common,
 * Fine uncommon, Superior rare, Pristine epic), never below the family's Common
 * grade. Graded resources used to read "common" while Common-grade traces read
 * "rare", so Pristine Iron Sand, a named-forge input, showed as a common item
 * (2026-10 item-use pass, census M5). Display only: materials cost 0, and the
 * level ladder (shared/item-level-gate.ts) never gates an unpriced item.
 */
export function resourceItemRarity(family: ResourceFamily, grade: ResourceGrade): ResourceRarity {
    return RARITY_LADDER[Math.max(RARITY_LADDER.indexOf(FAMILY_BASE_RARITY[family]), grade)];
}
export const RESOURCE_ITEMS = Object.entries(RESOURCE_FAMILIES).flatMap(([id, family]) => RESOURCE_GRADES.map((grade, index) => ({
    id: resourceItemId(id as ResourceFamily, index as ResourceGrade),
    name: `${index ? `${grade} ` : ''}${family.name}`, family: id as ResourceFamily, grade: index as ResourceGrade,
    activity: family.activity,
})));
