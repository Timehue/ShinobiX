import { addOwned, countOwned, removeOwned } from '../craft/_forge.js';
import { COOK_RECIPES as SHARED_COOK_RECIPES, type CookRecipeId, type CookRecipe } from '../../shared/cooking-recipes.js';
import { RESOURCE_ITEMS } from '../../shared/resource-gathering.js';
import {
    COOK_COUNT_FIELD, COOK_DATE_FIELD, DAILY_RATION_COOK_CAP, RATION_ITEM_ID,
    dailyCounter, stampDailyCounter, utcDay,
} from '../_village-stores.js';

export type CafeteriaMealId = 'small-ramen' | 'shinobi-meal' | 'feast';

export type CafeteriaMeal = {
    id: CafeteriaMealId;
    name: string;
    cost: number;
    // Flat floors — the pre-2026-07-31 values, kept so a low-level player never
    // restores less than before the percent retune.
    hp: number;
    chakra: number;
    stamina: number;
    // Percent-of-max restore (owner ruling 2026-07-31): the old flats were
    // tuned for ~100-HP pools and became dead options against the
    // combatResourcesV2 ~10k pools (25 HP ramen). Each bar restores
    // max(flat, floor(maxPool × pct/100)). Feast keeps its full-restore flats.
    hpPct?: number;
    chakraPct?: number;
    staminaPct?: number;
};

export const CAFETERIA_MEALS: Record<CafeteriaMealId, CafeteriaMeal> = {
    'small-ramen': { id: 'small-ramen', name: 'Small Ramen', cost: 20, hp: 25, chakra: 10, stamina: 10, hpPct: 10, chakraPct: 5, staminaPct: 5 },
    'shinobi-meal': { id: 'shinobi-meal', name: 'Shinobi Meal', cost: 50, hp: 75, chakra: 35, stamina: 35, hpPct: 25, chakraPct: 15, staminaPct: 15 },
    feast: { id: 'feast', name: 'Feast', cost: 100, hp: 9999, chakra: 9999, stamina: 9999 },
};

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function restoreAmount(flat: number, pct: number | undefined, maxPool: number): number {
    const fromPct = pct ? Math.floor(maxPool * (pct / 100)) : 0;
    return Math.max(flat, fromPct);
}

// ── Village Stores: COOK recipes (rations) ────────────────────────────────────
// Hunt materials + ryo → ration-pack stacks the player donates to the Town Hall
// (api/village/treasury/donate.ts → treasury.provisions). Per-player 40
// rations/day (UTC), a server counter on the save that only grows within a day.
export type { CookRecipeId, CookRecipe };
export const COOK_RECIPES: Record<string, CookRecipe> = Object.fromEntries(SHARED_COOK_RECIPES.map(recipe => [recipe.id, recipe]));

/** Display names for the edible cook materials. A refusal reaches the player as a
 *  sentence, so it must never carry a raw item id.
 *  Mirrored by COOK_MATERIAL_NAMES in shinobij.client/src/lib/cafeteria.ts. */
export const COOK_MATERIAL_NAMES: Record<string, string> = {
    ...Object.fromEntries(RESOURCE_ITEMS.filter(item => item.activity === 'fishing').map(item => [item.id, item.name])),
    'hunt-beast-meat': 'Beast Meat',
};

export function cookMaterialName(itemId: string): string {
    const id = String(itemId ?? '');
    return COOK_MATERIAL_NAMES[id] ?? id;
}

/** A recipe's accepted edible inputs, in words. */
export function cookMaterialChoiceName(recipe: CookRecipe): string {
    return recipe.materials.map(cookMaterialName).join(' or ');
}

export function cookRecipe(id: unknown): CookRecipe | null {
    const key = String(id ?? '') as CookRecipeId;
    return COOK_RECIPES[key] ?? null;
}

export type CookOutcome =
    | { ok: true; character: Record<string, unknown>; cooked: number; dailyCooked: number; dailyCap: number; materialUsed: string }
    | { ok: false; error: string; dailyCooked?: number; dailyCap?: number };

/** Pure: debit ryo, food, herbs and cooking fuel; credit ration-pack, bump the
 *  UTC-day cook counter. Refuses when the day's cap can't fit the whole batch. */
export function applyCookRecipe(character: Record<string, unknown>, recipe: CookRecipe, now: number = Date.now()): CookOutcome {
    const today = utcDay(now);
    const dailyCooked = dailyCounter(character, COOK_DATE_FIELD, COOK_COUNT_FIELD, today);
    if (dailyCooked + recipe.rations > DAILY_RATION_COOK_CAP) {
        return { ok: false, error: `Daily ration limit reached (${dailyCooked}/${DAILY_RATION_COOK_CAP} cooked today).`, dailyCooked, dailyCap: DAILY_RATION_COOK_CAP };
    }
    const ryo = num(character.ryo);
    if (ryo < recipe.ryo) return { ok: false, error: `Not enough ryo. ${recipe.name} costs ${recipe.ryo}.`, dailyCooked, dailyCap: DAILY_RATION_COOK_CAP };
    const materialCount = recipe.materialCount ?? 1;
    const materialUsed = recipe.materials.find((m) => countOwned(character, m) >= materialCount);
    if (!materialUsed) return { ok: false, error: `${recipe.name} needs ${materialCount} ${cookMaterialChoiceName(recipe)}.`, dailyCooked, dailyCap: DAILY_RATION_COOK_CAP };
    if (countOwned(character, 'gather-field-herb') < recipe.herbs)
        return { ok: false, error: `${recipe.name} needs ${recipe.herbs} Field Herb${recipe.herbs === 1 ? '' : 's'}.`, dailyCooked, dailyCap: DAILY_RATION_COOK_CAP };
    if (countOwned(character, 'gather-heartwood-bark') < recipe.fuel)
        return { ok: false, error: `${recipe.name} needs ${recipe.fuel} Heartwood Bark for cooking fuel.`, dailyCooked, dailyCap: DAILY_RATION_COOK_CAP };
    let next = removeOwned({ ...character, ryo: ryo - recipe.ryo }, materialUsed, materialCount);
    next = removeOwned(next, 'gather-field-herb', recipe.herbs);
    next = removeOwned(next, 'gather-heartwood-bark', recipe.fuel);
    next = addOwned(next, RATION_ITEM_ID, recipe.rations, true);
    next = stampDailyCounter(next, COOK_DATE_FIELD, COOK_COUNT_FIELD, today, dailyCooked + recipe.rations);
    return { ok: true, character: next, cooked: recipe.rations, dailyCooked: dailyCooked + recipe.rations, dailyCap: DAILY_RATION_COOK_CAP, materialUsed };
}

export function cafeteriaMeal(id: unknown): CafeteriaMeal | null {
    const key = String(id ?? '') as CafeteriaMealId;
    return CAFETERIA_MEALS[key] ?? null;
}

export function applyCafeteriaMeal(
    character: Record<string, unknown>,
    meal: CafeteriaMeal,
): { ok: true; character: Record<string, unknown> } | { ok: false; error: string } {
    const ryo = num(character.ryo);
    if (ryo < meal.cost) return { ok: false, error: `Not enough ryo. ${meal.name} costs ${meal.cost}.` };

    const maxHp = num(character.maxHp);
    const maxChakra = num(character.maxChakra);
    const maxStamina = num(character.maxStamina);
    return {
        ok: true,
        character: {
            ...character,
            ryo: ryo - meal.cost,
            hp: Math.min(maxHp, num(character.hp) + restoreAmount(meal.hp, meal.hpPct, maxHp)),
            chakra: Math.min(maxChakra, num(character.chakra) + restoreAmount(meal.chakra, meal.chakraPct, maxChakra)),
            stamina: Math.min(maxStamina, num(character.stamina) + restoreAmount(meal.stamina, meal.staminaPct, maxStamina)),
        },
    };
}
