import { ITEM_CATALOG, type CatalogItem } from '../pvp/_item-catalog.js';
import { HUNTER_RANK_REQUIREMENTS } from '../hunter/_rank-up.js';

// Materials the Hunter Guild consumes to rank up. Derived from the rank-up table
// so it can NEVER drift when those turn-ins change. consumeCraftPoints spares these
// until last, so crafting a supply doesn't silently cannibalize rank-up progress.
const RANK_UP_PROTECTED = new Set<string>(HUNTER_RANK_REQUIREMENTS.map((r) => r.itemId));

export const CRAFT_POINTS: Record<string, number> = {
    'hunt-torn-hide': 3, 'hunt-wild-feather': 3, 'hunt-small-fang': 3, 'hunt-cracked-horn': 3,
    'hunt-beast-meat': 5, 'hunt-frost-pelt': 8, 'hunt-shadow-claw': 8, 'hunt-wolf-fang': 10,
    'hunt-ash-scale': 15, 'hunt-ember-scale': 20, 'hunt-shadow-pelt': 25,
    'hunt-ancient-beast-core': 30, 'hunt-titan-bone': 30, 'hunt-legendary-material': 50,
    'weekly-boss-core': 150, 'dungeon-legendary-relic': 200, 'warforged-relic': 250, 'veil-of-the-hollow': 250,
};

const SUPPLY_RECIPES: Record<string, { points: number; count?: number; currency?: 'auraDust' | 'boneCharms'; amount?: number }> = {
    'pet-treat': { points: 50 }, 'elemental-pet-treat': { points: 100 },
    'currency:aura-dust': { points: 50, currency: 'auraDust', amount: 50 },
    'currency:bone-charm': { points: 1000, currency: 'boneCharms', amount: 1 },
    'thrown-shuriken': { points: 15, count: 3 }, 'thrown-senbon': { points: 30 },
    'thrown-serpent-dust': { points: 40 }, 'item-smoke-bomb': { points: 25 },
    'item-attack-pill': { points: 20 }, 'item-defense-pill': { points: 20 },
    'potion-rejuvenation': { points: 250 },
    'pve-hunters-bond-harness': { points: 280 }, 'pve-loyal-companion-bell': { points: 280 },
    'pve-frenzy-claw': { points: 350 }, 'pve-guardians-blessing': { points: 350 },
    'pve-sanguine-charm': { points: 350 }, 'pve-predators-fang': { points: 420 },
    'pve-avengers-pendant': { points: 420 }, 'pve-bloodbond-totem': { points: 420 },
    'pve-pack-alpha-crest': { points: 490 }, 'pve-apex-predator-fang': { points: 490 },
    'consum-phantom-charm': { points: 170 }, 'consum-smoke-pellet': { points: 170 },
    'consum-cleansing-incense': { points: 200 }, 'consum-thornmail-oil': { points: 220 },
    'consum-lifeline-elixir': { points: 250 }, 'consum-second-wind': { points: 280 },
};

const STACKABLE_OUTPUTS = new Set([...Object.keys(SUPPLY_RECIPES), 'dungeon-legendary-relic']);
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

export function consumeCraftPoints(character: Record<string, unknown>, pointsRaw: number): Record<string, unknown> | null {
    const required = count(pointsRaw); if (craftPointTotal(character) < required) return null;
    let next = character; let remaining = required;
    // Burn NORMAL fodder cheapest-first, then dip into rank-up-designated materials
    // only if the fodder can't cover the cost — so a routine craft never silently
    // eats a player's Hunter rank-up stock while any other material would do.
    const cheapestFirst = Object.entries(CRAFT_POINTS).sort((a, b) => a[1] - b[1]);
    const ordered = [
        ...cheapestFirst.filter(([id]) => !RANK_UP_PROTECTED.has(id)),
        ...cheapestFirst.filter(([id]) => RANK_UP_PROTECTED.has(id)),
    ];
    for (const [id, points] of ordered) {
        while (remaining > 0 && countOwned(next, id) > 0) { next = removeOwned(next, id, 1); remaining -= points; }
    }
    return next;
}

function ryoFor(item: CatalogItem): number { return item.rarity === 'rare' ? 600 : item.rarity === 'epic' ? 1400 : 3500; }
function itemPoints(item: CatalogItem, armor: boolean): number {
    if (item.rarity === 'rare') return armor ? 200 : 150;
    if (item.rarity === 'epic') return armor ? 400 : 350;
    return armor ? 800 : 700;
}

export type CraftKind = 'supply' | 'weapon' | 'armor' | 'relic';
export function applyForge(character: Record<string, unknown>, kind: CraftKind, recipeId: string, quantityRaw: unknown) {
    const quantity = Math.max(1, Math.min(20, count(quantityRaw) || 1));
    if (kind === 'relic') {
        if (recipeId !== 'dungeon-legendary-relic' || countOwned(character, 'dungeon-legendary-fragment') < 5) return null;
        return addOwned(removeOwned(character, 'dungeon-legendary-fragment', 5), recipeId, 1, true);
    }
    if (kind === 'supply') {
        const recipe = SUPPLY_RECIPES[recipeId]; if (!recipe) return null;
        const paid = consumeCraftPoints(character, recipe.points * quantity); if (!paid) return null;
        if (recipe.currency) return { ...paid, [recipe.currency]: count(paid[recipe.currency]) + (recipe.amount ?? 0) * quantity };
        return addOwned(paid, recipeId, (recipe.count ?? 1) * quantity, true);
    }
    const item = ITEM_CATALOG[recipeId]; if (!item || recipeId.startsWith('named-')) return null;
    const armor = kind === 'armor';
    const valid = armor
        ? ['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot) && item.rarity === 'rare' && Boolean(item.armorQuality)
        : item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity);
    if (!valid || count(character.level) < count(item.levelReq ?? 1)) return null;
    const ryo = ryoFor(item); if (count(character.ryo) < ryo) return null;
    const paid = consumeCraftPoints(character, itemPoints(item, armor)); if (!paid) return null;
    return addOwned({ ...paid, ryo: count(paid.ryo) - ryo }, recipeId, 1, false);
}
