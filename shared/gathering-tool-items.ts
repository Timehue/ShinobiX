export type GatheringToolSlot = 'fishingPole' | 'pickaxe';
export const GATHERING_TOOLS = [
    { id: 'tool-basic-fishing-pole', name: 'Basic Fishing Kunai', slot: 'fishingPole', cost: 150, rarity: 'common', durability: 50 },
    { id: 'tool-basic-pickaxe', name: 'Basic Pickaxe', slot: 'pickaxe', cost: 150, rarity: 'common', durability: 50 },
    { id: 'tool-golden-fishing-pole', name: 'Golden Fishing Kunai', slot: 'fishingPole', cost: 50, rarity: 'legendary', durability: null },
    { id: 'tool-golden-pickaxe', name: 'Golden Pickaxe', slot: 'pickaxe', cost: 50, rarity: 'legendary', durability: null },
] as const;
export type GatheringTool = typeof GATHERING_TOOLS[number];

// The two helpers below live here, not in gathering-tools.ts, because the
// client's startup graph already carries this file (through the item catalog)
// and the client's combat payload helpers need them at boot. Importing them from
// gathering-tools.ts split that module into its own startup chunk.
export function isGatheringToolSlot(slot: unknown): slot is GatheringToolSlot { return slot === 'fishingPole' || slot === 'pickaxe'; }
/**
 * The equipment every combat read uses. Gathering tools sit in the active
 * loadout, but they only drive fishing and mining, so PvP, towers, bosses and
 * PvE never see them. A tool id stored under any other key is dropped as well.
 * Returns the same object when there is nothing to drop.
 */
export function combatEquipment<T>(equipment: T): T {
    if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return equipment;
    const entries = Object.entries(equipment as Record<string, unknown>);
    const kept = entries.filter(([slot, id]) => !isGatheringToolSlot(slot) && !GATHERING_TOOLS.some(tool => tool.id === id));
    return (kept.length === entries.length ? equipment : Object.fromEntries(kept)) as T;
}
