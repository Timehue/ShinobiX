import { hasInventoryRoom } from '../_inventory-capacity.js';
export const AURA_SPHERE_EVENT_ID = 'builtin-aura-sphere-lv9';
export const AURA_SPHERE_ITEM_ID = 'aura-sphere';

export function claimBuiltinEvent(character: Record<string, unknown>, eventIdRaw: unknown) {
    const eventId = typeof eventIdRaw === 'string' ? eventIdRaw.trim() : '';
    if (eventId !== AURA_SPHERE_EVENT_ID) return { ok: false as const, reason: 'event-has-no-server-reward' as const };
    if (Math.max(1, Math.floor(Number(character.level) || 1)) < 9) return { ok: false as const, reason: 'level-required' as const };

    const claimed = Array.isArray(character.claimedCreatorEvents)
        ? (character.claimedCreatorEvents as unknown[]).filter((id): id is string => typeof id === 'string').slice(-127)
        : [];
    const inventory = Array.isArray(character.inventory)
        ? (character.inventory as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    const equipped = character.equipment && typeof character.equipment === 'object'
        ? Object.values(character.equipment as Record<string, unknown>).includes(AURA_SPHERE_ITEM_ID)
        : false;
    const alreadyOwned = inventory.includes(AURA_SPHERE_ITEM_ID) || equipped;
    if (claimed.includes(eventId) || alreadyOwned) {
        return { ok: true as const, alreadyClaimed: true, character: { ...character, claimedCreatorEvents: claimed.includes(eventId) ? claimed : [...claimed, eventId] } };
    }
    // Refuse BEFORE latching claimedCreatorEvents: the claim is one-time, so
    // burning the latch on a full bag would destroy the reward outright rather
    // than delaying it (MMORPG behavior audit F7). The player can claim it again
    // once they have room.
    if (!hasInventoryRoom(character)) {
        return { ok: false as const, reason: 'inventory-full' as const };
    }
    return {
        ok: true as const,
        alreadyClaimed: false,
        character: { ...character, inventory: [...inventory, AURA_SPHERE_ITEM_ID], claimedCreatorEvents: [...claimed, eventId] },
    };
}
