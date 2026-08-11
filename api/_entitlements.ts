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

/**
 * Stable pet ids that are eligible for current roster use: combat, breeding,
 * and starting new training or expeditions. Existing active and reserve
 * selections win first so a supporter lapse does not silently switch the
 * player's companions; the remaining slots follow roster order. Extra
 * legacy/lapsed records remain owned in character.pets as preserved overflow
 * until moved through the Sanctuary workflow. Existing sessions may still be
 * collected after a lapse so preservation never traps earned state.
 */
export function activeCarriedPetIds(character: unknown, petsOverride?: unknown): string[] {
    const char = character && typeof character === 'object'
        ? character as Record<string, unknown>
        : {};
    const pets = Array.isArray(petsOverride)
        ? petsOverride
        : (Array.isArray(char.pets) ? char.pets : []);
    const rosterIds = pets
        .map((pet) => pet && typeof pet === 'object' ? String((pet as Record<string, unknown>).id ?? '') : '')
        .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index);
    const prioritized = [String(char.activePetId ?? ''), String(char.activePetId2v2 ?? ''), ...rosterIds]
        .filter((id, index, ids) => Boolean(id) && rosterIds.includes(id) && ids.indexOf(id) === index);
    return prioritized.slice(0, maxPets(character));
}

export function activeCarriedPets<T = Record<string, unknown>>(character: unknown, petsOverride?: unknown): T[] {
    const char = character && typeof character === 'object'
        ? character as Record<string, unknown>
        : {};
    const pets = (Array.isArray(petsOverride)
        ? petsOverride
        : (Array.isArray(char.pets) ? char.pets : [])) as T[];
    const byId = new Map(pets.map((pet) => [String((pet as Record<string, unknown>)?.id ?? ''), pet]));
    return activeCarriedPetIds(character, pets)
        .map((id) => byId.get(id))
        .filter((pet): pet is T => pet !== undefined);
}

/**
 * Stable ids that occupy the character's currently usable custom-bloodline
 * storage slots. The equipped custom bloodline wins the first slot so a
 * supporter lapse never switches the player's build underneath them; the
 * remaining slots follow stored order. Entries beyond the entitlement cap are
 * retained as preserved overflow, but are not editable/equippable.
 */
export function activeStoredBloodlineIds(character: unknown, bloodlines: unknown): string[] {
    if (!Array.isArray(bloodlines)) return [];
    const ordered = bloodlines
        .map((bloodline) => bloodline && typeof bloodline === 'object'
            ? String((bloodline as Record<string, unknown>).id ?? '')
            : '')
        .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index);
    const equipped = character && typeof character === 'object'
        ? String((character as Record<string, unknown>).equippedBloodlineId ?? '')
        : '';
    const prioritized = equipped && ordered.includes(equipped)
        ? [equipped, ...ordered.filter((id) => id !== equipped)]
        : ordered;
    return prioritized.slice(0, maxStoredBloodlines(character));
}
export function canCustomAvatar(character: unknown): boolean {
    return isPatreonSubscriber(character);
}
export function isPresetAvatar(src: unknown): boolean {
    if (typeof src !== 'string') return false;
    // The creator ships the presets with a cache-buster ("/starter-avatar-one.webp?v=2"),
    // so compare on the path alone — an exact-string match silently stopped
    // recognising a preset the moment that query string was added.
    const path = src.trim().split(/[?#]/)[0];
    return PRESET_AVATARS.includes(path);
}

// Once an avatar has been published to the shared image bucket, the client
// hydrates `character.avatarImage` with the per-image REFERENCE URL
// `/api/img?id=avatar:<name>` (see loadCategoryOnce / hydrateImages in
// shinobij.client/src/App.tsx). That pointer is not a new custom upload: the
// bytes behind it are governed by POST /api/images, which already restricts a
// player to writing `avatar:<their-own-name>`, and every OTHER player's UI
// resolves the portrait from that same shared bucket regardless of what this
// save holds. Treating the pointer as a fresh custom avatar is what stripped
// `avatarImage` from every non-subscriber's save on write, so their own profile
// card, mobile HUD and sector marker fell back to initials on every login.
export function isOwnAvatarReference(src: unknown, playerName: unknown): boolean {
    if (typeof src !== 'string' || typeof playerName !== 'string') return false;
    const name = playerName.trim().toLowerCase();
    if (!name) return false;
    const query = src.trim();
    if (!query.startsWith('/api/img?')) return false;
    try {
        const id = new URLSearchParams(query.slice(query.indexOf('?') + 1)).get('id');
        return typeof id === 'string' && id.trim().toLowerCase() === `avatar:${name}`;
    } catch {
        return false;
    }
}
