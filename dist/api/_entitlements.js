"use strict";
/*
 * Canonical SERVER-SIDE Patreon perk caps + entitlement reads.
 *
 * The subscriber flag is character.patreon (server-owned — written only by the
 * signature-verified webhook / OAuth callback, see api/patreon/_patreon.ts, and
 * forced from stored on every save via ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS).
 * The save handler is the authoritative enforcement point for these caps.
 *
 * MIRROR: shinobij.client/src/lib/entitlements.ts must stay in sync (the client
 * shapes the UI to match; the server is the real boundary).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESET_AVATARS = exports.STORED_BLOODLINES_SUB = exports.STORED_BLOODLINES_BASE = exports.PET_CAP_SUB = exports.PET_CAP_BASE = exports.LOADOUT_CAP_SUB = exports.LOADOUT_CAP_BASE = void 0;
exports.isPatreonSubscriber = isPatreonSubscriber;
exports.maxLoadout = maxLoadout;
exports.maxPets = maxPets;
exports.maxStoredBloodlines = maxStoredBloodlines;
exports.canCustomAvatar = canCustomAvatar;
exports.isPresetAvatar = isPresetAvatar;
function isPatreonSubscriber(character) {
    const p = character?.patreon;
    if (!p || p.active !== true)
        return false;
    // Admin-comped subs carry an expiry; a lapsed comp reads as inactive without
    // a cron flipping the stored flag. Patreon-driven subs have no expiresAt.
    if (typeof p.expiresAt === 'number' && p.expiresAt > 0 && Date.now() >= p.expiresAt)
        return false;
    return true;
}
// Perk caps: base = non-subscriber, sub = $15 "Shinobi Supporter".
exports.LOADOUT_CAP_BASE = 12;
exports.LOADOUT_CAP_SUB = 15;
exports.PET_CAP_BASE = 3;
exports.PET_CAP_SUB = 5;
exports.STORED_BLOODLINES_BASE = 1;
exports.STORED_BLOODLINES_SUB = 2;
// Preset avatars available to everyone. Non-subscribers are limited to these;
// custom avatar uploads are a subscriber perk. Keep in sync with the client
// character-creator presets (characterCreatorCopy.ts STARTER_AVATARS).
exports.PRESET_AVATARS = ['/starter-avatar-one.webp', '/starter-avatar-two.webp'];
function maxLoadout(character) {
    return isPatreonSubscriber(character) ? exports.LOADOUT_CAP_SUB : exports.LOADOUT_CAP_BASE;
}
function maxPets(character) {
    return isPatreonSubscriber(character) ? exports.PET_CAP_SUB : exports.PET_CAP_BASE;
}
function maxStoredBloodlines(character) {
    return isPatreonSubscriber(character) ? exports.STORED_BLOODLINES_SUB : exports.STORED_BLOODLINES_BASE;
}
function canCustomAvatar(character) {
    return isPatreonSubscriber(character);
}
function isPresetAvatar(src) {
    return typeof src === 'string' && exports.PRESET_AVATARS.includes(src);
}
