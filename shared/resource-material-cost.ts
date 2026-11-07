import { RESOURCE_ITEMS } from './resource-items.js';

/**
 * Harvest goods take the same premium since Kama Reaping made them a skilled,
 * world-wide gathering activity like fishing and mining (owner, 2026-11-06).
 * Listed here rather than imported so this tiny module stays dependency-free.
 */
export const HARVEST_PREMIUM_IDS = ['gather-field-herb', 'gather-binding-fiber', 'gather-heartwood-bark', 'gather-shadow-thread'] as const;
const resourceIds = new Set<string>([...RESOURCE_ITEMS.map(item => item.id), ...HARVEST_PREMIUM_IDS]);

/** Recipe rows accepting fish, minerals or harvest goods cost 50% more, including substitutes. */
export function resourceIngredientCount(ids: readonly string[], count: number): number {
    return ids.some(id => resourceIds.has(id)) ? Math.ceil(count * 1.5) : count;
}
