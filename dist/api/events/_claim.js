"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AURA_SPHERE_ITEM_ID = exports.AURA_SPHERE_EVENT_ID = void 0;
exports.claimBuiltinEvent = claimBuiltinEvent;
exports.AURA_SPHERE_EVENT_ID = 'builtin-aura-sphere-lv9';
exports.AURA_SPHERE_ITEM_ID = 'aura-sphere';
function claimBuiltinEvent(character, eventIdRaw) {
    const eventId = typeof eventIdRaw === 'string' ? eventIdRaw.trim() : '';
    if (eventId !== exports.AURA_SPHERE_EVENT_ID)
        return { ok: false, reason: 'event-has-no-server-reward' };
    if (Math.max(1, Math.floor(Number(character.level) || 1)) < 9)
        return { ok: false, reason: 'level-required' };
    const claimed = Array.isArray(character.claimedCreatorEvents)
        ? character.claimedCreatorEvents.filter((id) => typeof id === 'string').slice(-127)
        : [];
    const inventory = Array.isArray(character.inventory)
        ? character.inventory.filter((id) => typeof id === 'string')
        : [];
    const equipped = character.equipment && typeof character.equipment === 'object'
        ? Object.values(character.equipment).includes(exports.AURA_SPHERE_ITEM_ID)
        : false;
    const alreadyOwned = inventory.includes(exports.AURA_SPHERE_ITEM_ID) || equipped;
    if (claimed.includes(eventId) || alreadyOwned) {
        return { ok: true, alreadyClaimed: true, character: { ...character, claimedCreatorEvents: claimed.includes(eventId) ? claimed : [...claimed, eventId] } };
    }
    return {
        ok: true,
        alreadyClaimed: false,
        character: { ...character, inventory: [...inventory, exports.AURA_SPHERE_ITEM_ID], claimedCreatorEvents: [...claimed, eventId] },
    };
}
