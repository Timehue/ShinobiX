import type { SectorBiome } from './sector-geo.js';

export const COMMON_GATHER_IDS = ['gather-field-herb', 'gather-binding-fiber', 'gather-iron-sand'] as const;
export type CommonGatherId = typeof COMMON_GATHER_IDS[number];
export const BIOME_GATHER_IDS: Readonly<Record<SectorBiome, string>> = {
    forest: 'gather-heartwood-bark', shadow: 'gather-shadow-thread', snow: 'gather-rime-crystal',
    volcano: 'gather-ember-ore', central: 'gather-stormglass-shard',
};
export const GATHER_NAMES: Readonly<Record<string, string>> = {
    'gather-field-herb': 'Field Herb', 'gather-binding-fiber': 'Binding Fiber', 'gather-iron-sand': 'Iron Sand',
    'gather-heartwood-bark': 'Heartwood Bark', 'gather-shadow-thread': 'Shadow Thread',
    'gather-rime-crystal': 'Rime Crystal', 'gather-ember-ore': 'Ember Ore', 'gather-stormglass-shard': 'Stormglass Shard',
};
export const GATHER_TRACE_CHANCE = 0.15;
export const MAX_PENDING_FINDS = 24;
/** Packed village goods use these exact inputs; workshop recipes add no points. */
export const GATHER_RECIPE_INGREDIENTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    'village-supply-bundle': { 'ration-pack': 5, 'gather-field-herb': 3, 'gather-binding-fiber': 3, 'gather-iron-sand': 3 },
    'village-supply-crate': { 'ration-pack': 20, 'gather-field-herb': 10, 'gather-binding-fiber': 10, 'gather-iron-sand': 10 },
};
export { VILLAGE_SUPPLY_GOODS, isVillageSupplyGood, provisionValue } from './gathering-supplies.js';
