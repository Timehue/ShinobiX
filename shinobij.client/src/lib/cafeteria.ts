import type { Character } from "../types/character";

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
// Hunt materials + ryo → ration-pack stacks the player donates at the Town
// Hall (→ treasury.provisions). Display mirror of api/player/_cafeteria.ts
// COOK_RECIPES + the 40/day cap — KEEP IN SYNC; the server is authoritative.

export type CookRecipeId = "field-rations" | "campaign-rations";
export type CookRecipe = {
    id: CookRecipeId;
    name: string;
    ryo: number;
    /** Any ONE of these is consumed (first owned wins). */
    materials: string[];
    rations: number;
};
export const COOK_RECIPES: CookRecipe[] = [
    { id: "field-rations", name: "Field Rations", ryo: 30, materials: ["hunt-beast-meat"], rations: 5 },
    { id: "campaign-rations", name: "Campaign Rations", ryo: 80, materials: ["hunt-frost-pelt", "hunt-ash-scale"], rations: 20 },
];
export const DAILY_RATION_COOK_CAP = 40;
export const RATION_ITEM_ID = "ration-pack";
export const COOK_MATERIAL_NAMES: Record<string, string> = {
    "hunt-beast-meat": "Beast Meat",
    "hunt-frost-pelt": "Frost Pelt",
    "hunt-ash-scale": "Ash Scale",
};
/** Every material any recipe can consume, in recipe order, de-duplicated. */
export const COOK_MATERIAL_IDS: string[] = Array.from(new Set(COOK_RECIPES.flatMap((r) => r.materials)));

/** The display name for a cook material — never the raw item id. */
export function cookMaterialName(itemId: string): string {
    return COOK_MATERIAL_NAMES[itemId] ?? itemId;
}

/** "Frost Pelt or Ash Scale" — a recipe's inputs, in words. */
export function cookMaterialChoiceName(recipe: CookRecipe): string {
    return recipe.materials.map(cookMaterialName).join(" or ");
}

/** Rations read as days of food, so the recipe line is voice and not a
 *  formula. Beyond the two shipped recipes it falls back to the numeral. */
const RATION_DAYS_IN_WORDS: Record<number, string> = { 5: "five", 10: "ten", 15: "fifteen", 20: "twenty", 30: "thirty", 40: "forty" };
const RECIPE_FOOD_NAME: Record<CookRecipeId, string> = {
    "field-rations": "field rations",
    "campaign-rations": "siege rations",
};

/** "Beast Meat and 30 ryo — five days of field rations." */
export function cookRecipeLine(recipe: CookRecipe): string {
    const days = RATION_DAYS_IN_WORDS[recipe.rations] ?? String(recipe.rations);
    return `${cookMaterialChoiceName(recipe)} and ${recipe.ryo} ryo — ${days} days of ${RECIPE_FOOD_NAME[recipe.id] ?? "rations"}.`;
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
    const material = recipe.materials.find((m) => countOwnedItem(character, m) > 0);
    if (!material) return { ok: false, reason: `Needs 1 ${cookMaterialChoiceName(recipe)}` };
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
    try {
        const res = await fetch("/api/player/cafeteria", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, recipeId }),
        });
        const data = await res.json().catch(() => ({})) as CookRationsResult;
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
        if (!res.ok || !data.ok) return { ...data, ok: false, error: data.error || "The cafeteria is too busy right now." };
        return { ...data, ok: true };
    } catch {
        return { ok: false, error: "The cafeteria is too busy right now." };
    }
}
