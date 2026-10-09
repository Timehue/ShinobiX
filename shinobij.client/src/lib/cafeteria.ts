import type { Character } from "../types/character";
import { COOK_RECIPES as SHARED_COOK_RECIPES, type CookRecipeId, type CookRecipe } from '../../../shared/cooking-recipes';
import { RESOURCE_ITEMS } from '../../../shared/resource-items';
import { pendingEconomyIntent, economyIntentSettled } from './economy-request-intent';

export type CafeteriaMealId = "small-ramen" | "shinobi-meal" | "feast";

export type CafeteriaMeal = {
    id: CafeteriaMealId;
    name: string;
    cost: number;
    // Flat floors (the pre-retune values); the server restores
    // max(flat, maxPool × pct/100) per bar — mirror of api/player/_cafeteria.ts,
    // KEEP IN SYNC (display-only here; the server is authoritative).
    hp: number;
    chakra: number;
    stamina: number;
    hpPct?: number;
    chakraPct?: number;
    staminaPct?: number;
};

export const CAFETERIA_MEALS: CafeteriaMeal[] = [
    { id: "small-ramen", name: "Small Ramen", cost: 20, hp: 25, chakra: 10, stamina: 10, hpPct: 10, chakraPct: 5, staminaPct: 5 },
    { id: "shinobi-meal", name: "Shinobi Meal", cost: 50, hp: 75, chakra: 35, stamina: 35, hpPct: 25, chakraPct: 15, staminaPct: 15 },
    { id: "feast", name: "Feast", cost: 100, hp: 9999, chakra: 9999, stamina: 9999 },
];

export type CafeteriaMealResult = {
    ok: boolean;
    error?: string;
    meal?: CafeteriaMeal;
    character?: Character;
    _saveVersion?: number;
};

// ── Village Stores: COOK recipes (rations) ─────────────────────────────────
// Shared food, herb and fuel requirements produce ration packs for journeys
// and Village Stores. The server owns debits and the 40-ration daily cap.

export type { CookRecipeId, CookRecipe };
export const COOK_RECIPES = SHARED_COOK_RECIPES;
export const DAILY_RATION_COOK_CAP = 40;
export const RATION_ITEM_ID = "ration-pack";
export const COOK_MATERIAL_NAMES: Record<string, string> = {
    ...Object.fromEntries(RESOURCE_ITEMS.filter(item => item.activity === 'fishing').map(item => [item.id, item.name])),
    "gather-field-herb": "Field Herb",
    "gather-heartwood-bark": "Heartwood Bark (fuel)",
    "hunt-beast-meat": "Beast Meat",
};
/** Every material any recipe can consume, in recipe order, de-duplicated. */
export const COOK_MATERIAL_IDS: string[] = Array.from(new Set(COOK_RECIPES.flatMap((r) => [...r.materials, 'gather-field-herb', 'gather-heartwood-bark'])));

/** The display name for a cook material — never the raw item id. */
export function cookMaterialName(itemId: string): string {
    return COOK_MATERIAL_NAMES[itemId] ?? itemId;
}

/** A recipe's edible inputs, in words. */
export function cookMaterialChoiceName(recipe: CookRecipe): string {
    return recipe.materials.map(cookMaterialName).join(" or ");
}

/** Rations read as days of food, so the recipe line is voice and not a
 *  formula. Beyond the two shipped recipes it falls back to the numeral. */
const RATION_DAYS_IN_WORDS: Record<number, string> = { 5: "five", 10: "ten", 15: "fifteen", 20: "twenty" };
const RECIPE_FOOD_NAME: Partial<Record<CookRecipeId, string>> = {
    "field-rations": "field rations",
    "campaign-rations": "siege rations",
};

/** Food, seasoning, cooking fuel and ryo, followed by the ration yield. */
export function cookRecipeLine(recipe: CookRecipe): string {
    const days = RATION_DAYS_IN_WORDS[recipe.rations] ?? String(recipe.rations);
    return `${recipe.materialCount ? `${recipe.materialCount} ` : ''}${cookMaterialChoiceName(recipe)}, ${recipe.herbs} Field Herb${recipe.herbs === 1 ? '' : 's'}, ${recipe.fuel} Heartwood Bark for fuel and ${recipe.ryo} ryo — ${days} days of ${RECIPE_FOOD_NAME[recipe.id] ?? "rations"}.`;
}

type OwnedShape = { inventory?: string[]; itemStacks?: { itemId: string; count: number }[] };

/** Copies of `itemId` owned: loose inventory slots + itemStacks (api/craft/_forge.ts countOwned). */
export function countOwnedItem(character: OwnedShape, itemId: string): number {
    const loose = (character.inventory ?? []).filter((id) => id === itemId).length;
    const stacked = (character.itemStacks ?? []).filter((s) => String(s?.itemId ?? "") === itemId).reduce((sum, s) => sum + Math.max(0, Math.floor(Number(s.count) || 0)), 0);
    return loose + stacked;
}

/** Rations this player already cooked today (UTC), read off the server-mirrored
 *  save counters (`rationsCookedDate` / `rationsCookedToday`). */
export function rationsCookedToday(character: object, now: number = Date.now()): number {
    const c = character as Record<string, unknown>;
    const today = new Date(now).toISOString().slice(0, 10);
    if (String(c.rationsCookedDate ?? "") !== today) return 0;
    return Math.max(0, Math.floor(Number(c.rationsCookedToday) || 0));
}

/** "Cooked today: 5/40 rations." */
export function cookRationsCapLine(character: object, now: number = Date.now()): string {
    return `Cooked today: ${rationsCookedToday(character, now)}/${DAILY_RATION_COOK_CAP} rations.`;
}

/** True when the player holds at least one unit of ANY cook material. False
 *  means the kitchen has nothing to work with, and the screen owes them the
 *  empty state rather than two dead buttons. */
export function hasAnyCookMaterial(character: OwnedShape): boolean {
    return COOK_MATERIAL_IDS.some((id) => countOwnedItem(character, id) > 0);
}

export type CookGate = { ok: true; material: string } | { ok: false; reason: string };

/** Why a recipe button is disabled (mirrors applyCookRecipe's checks, in its order). */
export function cookRecipeGate(character: OwnedShape & { ryo?: number }, recipe: CookRecipe, now: number = Date.now()): CookGate {
    const cooked = rationsCookedToday(character, now);
    if (cooked + recipe.rations > DAILY_RATION_COOK_CAP) return { ok: false, reason: `Daily limit: ${cooked}/${DAILY_RATION_COOK_CAP} rations cooked today` };
    if (Math.floor(Number(character.ryo) || 0) < recipe.ryo) return { ok: false, reason: `Not enough ryo (${recipe.ryo} needed)` };
    const material = recipe.materials.find((m) => countOwnedItem(character, m) >= (recipe.materialCount ?? 1));
    if (!material) return { ok: false, reason: `Needs ${recipe.materialCount ?? 1} ${cookMaterialChoiceName(recipe)}` };
    if (countOwnedItem(character, 'gather-field-herb') < recipe.herbs) return { ok: false, reason: `Needs ${recipe.herbs} Field Herb${recipe.herbs === 1 ? '' : 's'} (have ${countOwnedItem(character, 'gather-field-herb')})` };
    if (countOwnedItem(character, 'gather-heartwood-bark') < recipe.fuel) return { ok: false, reason: `Needs ${recipe.fuel} Heartwood Bark for cooking fuel (have ${countOwnedItem(character, 'gather-heartwood-bark')})` };
    return { ok: true, material };
}

export type CookRationsResult = {
    ok: boolean;
    error?: string;
    recipe?: CookRecipe;
    cooked?: number;
    dailyCooked?: number;
    dailyCap?: number;
    character?: Character;
    _saveVersion?: number;
};

export async function cookRations(playerName: string, recipeId: CookRecipeId): Promise<CookRationsResult> {
    const intent = pendingEconomyIntent('cook-rations', [playerName, recipeId]);
    try {
        const res = await fetch("/api/player/cafeteria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, recipeId, requestId: intent.requestId }),
        });
        const data = await res.json().catch(() => ({})) as CookRationsResult;
        if (economyIntentSettled(res.status, data)) intent.complete();
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || "The kitchen is too busy right now." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "The kitchen is too busy right now." };
    }
}

export async function buyCafeteriaMeal(playerName: string, mealId: CafeteriaMealId): Promise<CafeteriaMealResult> {
    try {
        const res = await fetch("/api/player/cafeteria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, mealId }),
        });
        const data = await res.json().catch(() => ({})) as CafeteriaMealResult;
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || "The Noodle Den is too busy right now." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "The Noodle Den is too busy right now." };
    }
}
