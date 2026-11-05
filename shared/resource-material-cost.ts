import { RESOURCE_ITEMS } from './resource-items.js';

const resourceIds = new Set<string>(RESOURCE_ITEMS.map(item => item.id));

/** Recipe rows accepting fish or minerals cost 50% more, including substitutes. */
export function resourceIngredientCount(ids: readonly string[], count: number): number {
    return ids.some(id => resourceIds.has(id)) ? Math.ceil(count * 1.5) : count;
}
