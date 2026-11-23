/*
 * Hand a quest fight its tool.
 *
 * A quest tool is never worn: the save sanitizer refuses to equip it and the
 * fighter built from a save never carries it (shared/quest-items.ts). So the
 * fight that needs it is given it here, by the server, as the fight is sealed.
 * It is placed under its own equipment key, with the item's catalogue
 * definition and an explicit charge count taken from what the player really
 * holds, and the boss's Hold is sealed beside it.
 *
 * Used charges are recorded on the session like any other item's, so the
 * ordinary fight settlement debits them from the backpack, win or lose.
 */
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { sealBossHold } from './_boss-hold.js';
import type { SoloPveSession } from './_session.js';

/** The equipment key a quest tool sits under. Not a real slot: nothing but this file writes it. */
export const QUEST_TOOL_EQUIPMENT_KEY = 'questTool';
/** No fight needs more than this, and it bounds what one fight can spend. */
export const QUEST_TOOL_MAX_CHARGES = 9;

export type QuestFightHold = { breakerItemId: string; name: string; charges: number };

/** The equipment key of the nth tool: `questTool`, then `questTool2`, `questTool3`. */
export function questToolEquipmentKey(index: number): string {
    return index === 0 ? QUEST_TOOL_EQUIPMENT_KEY : `${QUEST_TOOL_EQUIPMENT_KEY}${index + 1}`;
}

/**
 * `hold.next` lists the Holds that rise after the first, in order. Every Hold
 * in the chain has its tool handed over here, each under its own equipment
 * key, so the player holds all of them from the first round.
 */
export function sealQuestFightKit(
    session: SoloPveSession,
    hold: QuestFightHold & { next?: readonly QuestFightHold[] },
): void {
    const chain: QuestFightHold[] = [hold, ...(hold.next ?? [])];
    const character = { ...session.player.character };
    const items = Array.isArray(character.pvpItems) ? [...character.pvpItems as Array<Record<string, unknown>>] : [];
    const equipment = character.equipment && typeof character.equipment === 'object'
        ? { ...character.equipment as Record<string, unknown> }
        : {};
    const itemCharges = { ...session.itemCharges };
    chain.forEach((link, index) => {
        const item = ITEM_CATALOG[link.breakerItemId];
        if (!item?.questOnly) throw new Error(`Quest tool ${link.breakerItemId} is not a quest item.`);
        const charges = Math.max(0, Math.min(QUEST_TOOL_MAX_CHARGES, Math.floor(Number(link.charges) || 0)));
        if (charges < 1) throw new Error('A quest fight cannot be sealed without its tool.');
        if (!items.some(existing => existing.id === item.id)) items.push({ ...item });
        equipment[questToolEquipmentKey(index)] = item.id;
        // Explicit, always: an item with no sealed charge count would be unlimited.
        itemCharges[item.id] = charges;
    });
    session.player = { ...session.player, character: { ...character, pvpItems: items, equipment } };
    session.itemCharges = itemCharges;
    sealBossHold(session, { breakerItemId: hold.breakerItemId, name: hold.name }, chain.slice(1));
}
