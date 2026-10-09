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
export const RESOURCE_ITEMS = Object.entries(RESOURCE_FAMILIES).flatMap(([id, family]) => RESOURCE_GRADES.map((grade, index) => ({
    id: resourceItemId(id as ResourceFamily, index as ResourceGrade),
    name: `${index ? `${grade} ` : ''}${family.name}`, family: id as ResourceFamily, grade: index as ResourceGrade,
    activity: family.activity,
})));
