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
/** Exact ingredients are never part of the generic craft-point pool. */
export const GATHER_RECIPE_INGREDIENTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    'item-smoke-bomb': { 'gather-binding-fiber': 1 },
    'potion-rejuvenation': { 'gather-field-herb': 2 },
    'thrown-shuriken': { 'gather-iron-sand': 2 },
    'elderbranch-katana': { 'gather-heartwood-bark': 6, 'gather-binding-fiber': 100 },
    'black-lotus-dagger': { 'gather-shadow-thread': 6, 'gather-iron-sand': 100 },
    'frostfang-oathblade': { 'gather-rime-crystal': 6, 'gather-iron-sand': 100 },
    'embercoil-scythe': { 'gather-ember-ore': 6, 'gather-iron-sand': 100 },
    'tempest-fang-blade': { 'gather-stormglass-shard': 6, 'gather-binding-fiber': 100 },
    'village-supply-bundle': { 'ration-pack': 5, 'gather-field-herb': 3, 'gather-binding-fiber': 3, 'gather-iron-sand': 3 },
    'village-supply-crate': { 'ration-pack': 20, 'gather-field-herb': 10, 'gather-binding-fiber': 10, 'gather-iron-sand': 10 },
};
export const VILLAGE_SUPPLY_GOODS: Readonly<Record<string, { name: string; ryo: number; provisions: number }>> = {
    'village-supply-bundle': { name: 'Village Supply Bundle', ryo: 30, provisions: 10 },
    'village-supply-crate': { name: 'Village Supply Crate', ryo: 100, provisions: 40 },
};
export function isVillageSupplyGood(id: string): boolean { return Object.hasOwn(VILLAGE_SUPPLY_GOODS, id); }
export function provisionValue(id: string): number { return id === 'ration-pack' ? 1 : VILLAGE_SUPPLY_GOODS[id]?.provisions ?? 0; }
