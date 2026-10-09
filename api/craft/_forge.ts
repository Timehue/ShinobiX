import { VILLAGE_SUPPLY_GOODS, isVillageSupplyGood } from '../../shared/gathering.js';
import { villageStoresEnabled } from '../_release-flags.js';
import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../../shared/item-level-gate.js';
import { isStepItemId } from '../../shared/gear-steps.js';
import { withGearTierUnlock } from '../_gear-drops.js';
import { SUPPLY_CRAFT_RECIPES, gearCraftIngredients, planCraftIngredients, planSelectedCraftIngredients, type CraftIngredient } from '../../shared/crafting-recipes.js';

// Legacy material-point valuations remain the Village Stores donation contract.
// The Crafter now consumes the exact ingredients in shared/crafting-recipes.ts.
export const CRAFT_POINTS: Record<string, number> = {
    'hunt-torn-hide': 3, 'hunt-wild-feather': 3, 'hunt-small-fang': 3, 'hunt-cracked-horn': 3,
    'hunt-beast-meat': 5, 'hunt-frost-pelt': 8, 'hunt-shadow-claw': 8, 'hunt-wolf-fang': 10,
    'hunt-ash-scale': 15, 'hunt-ember-scale': 20, 'hunt-shadow-pelt': 25,
    'hunt-ancient-beast-core': 30, 'hunt-titan-bone': 30, 'hunt-legendary-material': 50,
    'weekly-boss-core': 150, 'dungeon-legendary-relic': 200, 'warforged-relic': 250, 'veil-of-the-hollow': 250,
};

const STACKABLE_OUTPUTS = new Set([...Object.keys(SUPPLY_CRAFT_RECIPES), 'dungeon-legendary-relic']);
const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

export function countOwned(character: Record<string, unknown>, itemId: string): number {
    const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    return inventory.filter((id) => id === itemId).length
        + stacks.filter((s) => String(s?.itemId ?? '') === itemId).reduce((sum, s) => sum + count(s.count), 0);
}

export function removeOwned(character: Record<string, unknown>, itemId: string, amountRaw: number): Record<string, unknown> {
    let remaining = count(amountRaw);
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    const nextStacks = stacks.map((stack) => {
        if (remaining <= 0 || String(stack?.itemId ?? '') !== itemId) return stack;
        const take = Math.min(count(stack.count), remaining); remaining -= take;
        return { ...stack, count: count(stack.count) - take };
    }).filter((stack) => count(stack.count) > 0);
    const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
    const nextInventory = inventory.filter((id) => {
        if (id === itemId && remaining > 0) { remaining -= 1; return false; }
        return true;
    });
    return { ...character, inventory: nextInventory, itemStacks: nextStacks };
}

export function addOwned(character: Record<string, unknown>, itemId: string, amountRaw: number, stackable = STACKABLE_OUTPUTS.has(itemId)): Record<string, unknown> {
    const amount = count(amountRaw); if (!amount) return character;
    if (!stackable) {
        const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
        return { ...character, inventory: [...inventory, ...Array.from({ length: amount }, () => itemId)] };
    }
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as Array<Record<string, unknown>> : [];
    const found = stacks.some((s) => String(s?.itemId ?? '') === itemId);
    return {
        ...character,
        itemStacks: found
            ? stacks.map((s) => String(s?.itemId ?? '') === itemId ? { ...s, count: count(s.count) + amount } : s)
            : [...stacks, { itemId, count: amount }],
    };
}

export function craftPointTotal(character: Record<string, unknown>): number {
    return Object.entries(CRAFT_POINTS).reduce((sum, [id, points]) => sum + countOwned(character, id) * points, 0);
}

function ryoFor(item: CatalogItem): number { return item.rarity === 'rare' ? 600 : item.rarity === 'epic' ? 1400 : 3500; }
export function consumeRecipeIngredients(character: Record<string, unknown>, ingredients: readonly CraftIngredient[], quantity = 1, materials?: unknown): Record<string, unknown> | null {
    const owned = (id: string) => countOwned(character, id);
    const plan = materials === undefined ? planCraftIngredients(ingredients, owned, quantity) : planSelectedCraftIngredients(ingredients, owned, quantity, materials);
    return plan ? Object.entries(plan).reduce((next, [id, amount]) => removeOwned(next, id, amount), character) : null;
}

export type CraftKind = 'supply' | 'weapon' | 'armor' | 'relic';
export function applyForge(character: Record<string, unknown>, kind: CraftKind, recipeId: string, quantityRaw: unknown, materials?: unknown) {
    const quantity = Math.max(1, Math.min(20, count(quantityRaw) || 1));
    if (kind === 'relic') {
        if (recipeId !== 'dungeon-legendary-relic' || countOwned(character, 'dungeon-legendary-fragment') < 5) return null;
        return addOwned(removeOwned(character, 'dungeon-legendary-fragment', 5), recipeId, 1, true);
    }
    if (kind === 'supply') {
        const recipe = Object.hasOwn(SUPPLY_CRAFT_RECIPES, recipeId) ? SUPPLY_CRAFT_RECIPES[recipeId] : undefined;
        if (!recipe || count(character.level) < (recipe.levelReq ?? 1)) return null;
        if (isVillageSupplyGood(recipeId) && !villageStoresEnabled()) return null;
        const ryo = (VILLAGE_SUPPLY_GOODS[recipeId]?.ryo ?? 0) * quantity;
        if (count(character.ryo) < ryo) return null;
        const output = ITEM_CATALOG[recipeId];
        const cap = output?.slot === 'thrown' ? 50 : output?.slot === 'potion' ? 2
            : output?.slot === 'item' && (output.weaponEffect != null || output.apCost != null || output.restoreChakra != null || output.restoreStamina != null) ? 50 : null;
        if (cap != null && countOwned(character, recipeId) + (recipe.count ?? 1) * quantity > cap) return null;
        const exact = consumeRecipeIngredients(character, recipe.ingredients, quantity, materials); if (!exact) return null;
        const paid: Record<string, unknown> = { ...exact, ryo: count(character.ryo) - ryo };
        if (recipe.currency) return { ...paid, [recipe.currency]: count(paid[recipe.currency]) + (recipe.amount ?? 0) * quantity };
        return addOwned(paid, recipeId, (recipe.count ?? 1) * quantity, true);
    }
    // Gear step drops cost 0 and are never a recipe: they only arrive as drops.
    const item = ITEM_CATALOG[recipeId]; if (!item || recipeId.startsWith('named-') || isStepItemId(recipeId)) return null;
    const armor = kind === 'armor';
    const valid = armor
        ? ['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot) && item.rarity === 'rare' && Boolean(item.armorQuality)
        : item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity);
    // Use the shared ladder, not the raw `levelReq`: crafting is an acquisition
    // path like buying, so it must agree with the shop and the equip gate.
    // Reading the raw field would let a player craft a tier they cannot wear.
    if (!valid || count(character.level) < effectiveItemLevelReq(item)) return null;
    const ryo = ryoFor(item) * quantity; if (count(character.ryo) < ryo) return null;
    const paid = consumeRecipeIngredients(character, gearCraftIngredients(item), quantity, materials); if (!paid) return null;
    return withGearTierUnlock(addOwned({ ...paid, ryo: count(paid.ryo) - ryo }, recipeId, quantity, false), item);
}
