// Client mirror of the Patreon entitlement reads in api/_entitlements.ts.
//
// The AUTHORITATIVE subscriber flag lives on `character.patreon` (server-owned;
// see types/character.ts) and the real perk enforcement is the server-side
// clamp in api/save/[name].ts. These helpers shape the UI to match, so a
// subscriber sees their raised caps and a non-subscriber sees the base ones.
// Never treat a client check as the security boundary.
//
// MIRROR: keep the caps here in sync with api/_entitlements.ts.

import type { Character } from '../types/character';

type WithPatreon = Pick<Character, 'patreon'> | null | undefined;

export function isPatreonSubscriber(character: WithPatreon): boolean {
    const p = character?.patreon;
    if (!p || p.active !== true) return false;
    // Admin-comped subs auto-expire; a lapsed comp reads as inactive (mirrors
    // api/_entitlements.ts). Patreon-driven subs have no expiresAt.
    if (typeof p.expiresAt === 'number' && p.expiresAt > 0 && Date.now() >= p.expiresAt) return false;
    return true;
}

export function subscriberTier(character: WithPatreon): string | null {
    return isPatreonSubscriber(character) ? (character?.patreon?.tier ?? 'shinobi-supporter') : null;
}

// Perk caps: base = non-subscriber, sub = $15 "Shinobi Supporter".
export const LOADOUT_CAP_BASE = 12;
export const LOADOUT_CAP_SUB = 15;
export const PET_CAP_BASE = 3;
export const PET_CAP_SUB = 5;
export const STORED_BLOODLINES_BASE = 1;
export const STORED_BLOODLINES_SUB = 2;
export const PRESET_AVATARS = ['/starter-avatar-one.webp', '/starter-avatar-two.webp'] as const;

export function maxLoadout(character: WithPatreon): number {
    return isPatreonSubscriber(character) ? LOADOUT_CAP_SUB : LOADOUT_CAP_BASE;
}
export function maxPets(character: WithPatreon): number {
    return isPatreonSubscriber(character) ? PET_CAP_SUB : PET_CAP_BASE;
}
export function maxStoredBloodlines(character: WithPatreon): number {
    return isPatreonSubscriber(character) ? STORED_BLOODLINES_SUB : STORED_BLOODLINES_BASE;
}
export function canCustomAvatar(character: WithPatreon): boolean {
    return isPatreonSubscriber(character);
}
export function isPresetAvatar(src: unknown): boolean {
    if (typeof src !== 'string') return false;
    // Presets ship with a cache-buster ("/starter-avatar-one.webp?v=2"), so
    // compare on the path alone — mirrors api/_entitlements.ts.
    const path = src.trim().split(/[?#]/)[0];
    return (PRESET_AVATARS as readonly string[]).includes(path);
}

// Mirror of api/_entitlements.ts. `/api/img?id=avatar:<name>` is the per-image
// reference the client hydrates into character.avatarImage once the portrait is
// in the shared bucket — a pointer to the player's own published image, not a
// new custom upload, so it is not gated behind the subscriber perk.
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
