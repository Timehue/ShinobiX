import { FISH_RECIPES, type FishRecipeId } from './fish-recipes.js';
/**
 * What burns as fuel, spent in this order. Heartwood Bark is the scarce one, so
 * Common Ember Ore and Ember Scale ("still warm to the touch") stand in for it
 * 1:1 at the Noodle Den and the forge (2026-10 rebalance, item-use pass: Ember
 * Ore had one recipe row and Ember Scale none of its own).
 */
export const FUEL_IDS = ['gather-heartwood-bark', 'gather-ember-ore', 'hunt-ember-scale'] as const;
export type CookRecipeId = 'field-rations' | 'campaign-rations' | FishRecipeId;
export type CookRecipe = {
    id: CookRecipeId; name: string; ryo: number; materials: readonly string[];
    materialCount?: number; rations: number; herbs: number; fuel: number;
};
/** One large cut feeds five; a campaign batch preserves four cuts for twenty. */
export const COOK_RECIPES: readonly CookRecipe[] = [
    ...FISH_RECIPES,
    { id: 'field-rations', name: 'Field Rations', ryo: 30, materials: ['hunt-beast-meat'], materialCount: 1, rations: 5, herbs: 1, fuel: 1 },
    { id: 'campaign-rations', name: 'Campaign Rations', ryo: 80, materials: ['hunt-beast-meat'], materialCount: 4, rations: 20, herbs: 2, fuel: 2 },
];
