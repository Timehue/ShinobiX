"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AURA_SPHERE_ITEM_ID = void 0;
exports.auraSphereDustNeeded = auraSphereDustNeeded;
exports.feedAuraSphere = feedAuraSphere;
exports.AURA_SPHERE_ITEM_ID = 'aura-sphere';
function auraSphereDustNeeded(levelRaw) {
    const level = Math.max(1, Math.min(300, Math.floor(Number(levelRaw) || 1)));
    return Math.floor(12 + level * 2.5);
}
function ownsAuraSphere(character) {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const equipment = character.equipment && typeof character.equipment === 'object'
        ? Object.values(character.equipment)
        : [];
    return inventory.includes(exports.AURA_SPHERE_ITEM_ID) || equipment.includes(exports.AURA_SPHERE_ITEM_ID);
}
function feedAuraSphere(character, actionIdRaw) {
    const actionId = typeof actionIdRaw === 'string' ? actionIdRaw.trim().slice(0, 80) : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId))
        return { ok: false, reason: 'invalid-action-id' };
    const receipts = Array.isArray(character.redeemedAuraFeeds)
        ? character.redeemedAuraFeeds.filter((id) => typeof id === 'string').slice(-127)
        : [];
    if (receipts.includes(actionId))
        return { ok: true, alreadyApplied: true, cost: 0, character };
    if (!ownsAuraSphere(character))
        return { ok: false, reason: 'aura-sphere-not-owned' };
    const level = Math.max(1, Math.floor(Number(character.auraSphereLevel) || 1));
    if (level >= 300)
        return { ok: false, reason: 'aura-sphere-max-level' };
    const cost = auraSphereDustNeeded(level);
    const dust = Math.max(0, Math.floor(Number(character.auraDust) || 0));
    if (dust < cost)
        return { ok: false, reason: 'insufficient-aura-dust' };
    return {
        ok: true,
        alreadyApplied: false,
        cost,
        character: {
            ...character,
            auraDust: dust - cost,
            auraSphereLevel: level + 1,
            redeemedAuraFeeds: [...receipts, actionId],
        },
    };
}
