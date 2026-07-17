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

type WithPatreon = { patreon?: { active?: boolean; tier?: string; expiresAt?: number } } | null | undefined;

export function isPatreonSubscriber(character: unknown): boolean {
    const p = (character as WithPatreon)?.patreon;
    if (!p || p.active !== true) return false;
    // Admin-comped subs carry an expiry; a lapsed comp reads as inactive without
    // a cron flipping the stored flag. Patreon-driven subs have no expiresAt.
    if (typeof p.expiresAt === 'number' && p.expiresAt > 0 && Date.now() >= p.expiresAt) return false;
    return true;
}

// Perk caps: base = non-subscriber, sub = $15 "Shinobi Supporter".
export const LOADOUT_CAP_BASE = 12;
export const LOADOUT_CAP_SUB = 15;
export const PET_CAP_BASE = 3;
export const PET_CAP_SUB = 5;
export const STORED_BLOODLINES_BASE = 1;
export const STORED_BLOODLINES_SUB = 2;

// Preset avatars available to everyone. Non-subscribers are limited to these;
// custom avatar uploads are a subscriber perk. Keep in sync with the client
// character-creator presets (characterCreatorCopy.ts STARTER_AVATARS).
export const PRESET_AVATARS: readonly string[] = ['/starter-avatar-one.webp', '/starter-avatar-two.webp'];

export function maxLoadout(character: unknown): number {
    return isPatreonSubscriber(character) ? LOADOUT_CAP_SUB : LOADOUT_CAP_BASE;
}
export function maxPets(character: unknown): number {
    return isPatreonSubscriber(character) ? PET_CAP_SUB : PET_CAP_BASE;
}
export function maxStoredBloodlines(character: unknown): number {
    return isPatreonSubscriber(character) ? STORED_BLOODLINES_SUB : STORED_BLOODLINES_BASE;
}
export function canCustomAvatar(character: unknown): boolean {
    return isPatreonSubscriber(character);
}
export function isPresetAvatar(src: unknown): boolean {
    return typeof src === 'string' && PRESET_AVATARS.includes(src);
}
