import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';

const SERVER_OWNED_ITEM_IDS = new Set([
    'weekly-boss-core',
    'dungeon-key',
    'dungeon-legendary-relic',
    'dungeon-legendary-fragment',
    'veil-of-the-hollow',
    'warforged-relic',
    'legendary-war-crate',
    'hunt-legendary-material',
    'hunt-ancient-beast-core',
    'hunt-titan-bone',
]);

function countStrings(raw: unknown): Map<string, number> {
    const counts = new Map<string, number>();
    if (!Array.isArray(raw)) return counts;
    for (const value of raw) {
        const id = typeof value === 'string' ? value : '';
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}

function stackCounts(raw: unknown): Map<string, number> {
    const counts = new Map<string, number>();
    if (!Array.isArray(raw)) return counts;
    for (const value of raw) {
        if (!value || typeof value !== 'object') continue;
        const entry = value as Record<string, unknown>;
        const itemId = typeof entry.itemId === 'string' ? entry.itemId : '';
        const count = Math.max(0, Math.floor(Number(entry.count ?? 0)));
        if (!itemId || count <= 0) continue;
        counts.set(itemId, (counts.get(itemId) ?? 0) + count);
    }
    return counts;
}

export function preserveOwnedItems(
    incomingInventory: unknown,
    incomingStacks: unknown,
    existingInventory: unknown,
    existingStacks: unknown,
): { inventory: string[]; itemStacks: Array<{ itemId: string; count: number }> } {
    const allowed = countStrings(existingInventory);
    for (const [id, count] of stackCounts(existingStacks)) allowed.set(id, (allowed.get(id) ?? 0) + count);
    const used = new Map<string, number>();
    const inventory: string[] = [];
    if (Array.isArray(incomingInventory)) {
        for (const raw of incomingInventory) {
            const id = typeof raw === 'string' ? raw : '';
            if (!id || (used.get(id) ?? 0) >= (allowed.get(id) ?? 0)) continue;
            used.set(id, (used.get(id) ?? 0) + 1);
            inventory.push(id);
        }
    }
    const itemStacks: Array<{ itemId: string; count: number }> = [];
    for (const [itemId, requested] of stackCounts(incomingStacks)) {
        const remaining = Math.max(0, (allowed.get(itemId) ?? 0) - (used.get(itemId) ?? 0));
        const count = Math.min(requested, remaining);
        if (count > 0) itemStacks.push({ itemId, count });
    }
    return { inventory, itemStacks };
}

export function isServerOwnedItemId(itemId: string): boolean {
    return SERVER_OWNED_ITEM_IDS.has(itemId);
}

export function isHighRiskTileCardId(cardId: string): boolean {
    const rarity = BUILTIN_CLASH[cardId]?.rarity;
    return rarity === 'epic' || rarity === 'legendary';
}

export function preserveEntitledStringArray(
    incoming: unknown,
    existing: unknown,
    isGuardedId: (id: string) => boolean,
): string[] | null {
    if (!Array.isArray(incoming)) return null;
    const existingCounts = countStrings(existing);
    const keptGuarded = new Map<string, number>();
    const out: string[] = [];
    for (const raw of incoming) {
        const id = typeof raw === 'string' ? raw : '';
        if (!id) continue;
        if (!isGuardedId(id)) {
            out.push(id);
            continue;
        }
        const used = keptGuarded.get(id) ?? 0;
        const allowed = existingCounts.get(id) ?? 0;
        if (used >= allowed) continue;
        keptGuarded.set(id, used + 1);
        out.push(id);
    }
    return out;
}

export function preserveEntitledStacks(
    incoming: unknown,
    existing: unknown,
    isGuardedId: (id: string) => boolean,
): Array<{ itemId: string; count: number }> | null {
    if (!Array.isArray(incoming)) return null;
    const incomingCounts = stackCounts(incoming);
    const existingCounts = stackCounts(existing);
    const out: Array<{ itemId: string; count: number }> = [];
    for (const [itemId, count] of incomingCounts.entries()) {
        const guarded = isGuardedId(itemId);
        const allowed = guarded ? Math.min(count, existingCounts.get(itemId) ?? 0) : count;
        if (allowed > 0) out.push({ itemId, count: allowed });
    }
    return out;
}
