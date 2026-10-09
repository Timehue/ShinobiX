import { GATHERING_TOOLS, type GatheringTool, type GatheringToolSlot } from './gathering-tool-items';
export { GATHERING_TOOLS } from './gathering-tool-items';
export type { GatheringTool, GatheringToolSlot } from './gathering-tool-items';
export function gatheringTool(id: unknown): GatheringTool | undefined { return GATHERING_TOOLS.find(tool => tool.id === id); }
export function gatheringToolOwned(character: object, id: string): boolean {
    const c = character as { inventory?: string[]; equipment?: Record<string, string> };
    return Boolean(c.inventory?.includes(id) || Object.values(c.equipment ?? {}).includes(id));
}
export function gatheringToolRemaining(character: object, id: string): number | null {
    const tool = gatheringTool(id); if (!tool) return 0;
    if (tool.durability == null) return null;
    const c = character as { gatheringToolUses?: Record<string, number> };
    // Only a shop grant initializes a basic tool. Missing durability fails closed.
    if (c.gatheringToolUses?.[id] == null) return 0;
    return Math.max(0, tool.durability - Math.max(0, Math.floor(c.gatheringToolUses[id])));
}
export function initializeGatheringTool<T extends Record<string, unknown>>(character: T, id: string): T {
    if (!gatheringTool(id)) return character;
    return { ...character, gatheringToolUses: { ...(character.gatheringToolUses as object ?? {}), [id]: 0 } };
}
/** Debit at admission. The 50th use still resolves; the broken tool leaves its slot. */
export function useGatheringTool(character: Record<string, unknown>, slot: GatheringToolSlot) {
    const equipment = { ...(character.equipment as Record<string, string> ?? {}) };
    const id = equipment[slot], tool = gatheringTool(id);
    if (!tool || tool.slot !== slot) return null;
    const remaining = gatheringToolRemaining(character, id);
    if (remaining === 0) return null;
    if (remaining === null) return { character, broke: false };
    const uses = { ...(character.gatheringToolUses as Record<string, number> ?? {}), [id]: 51 - remaining };
    const broke = remaining === 1;
    if (broke) delete equipment[slot];
    return { character: { ...character, equipment, gatheringToolUses: uses }, broke };
}
