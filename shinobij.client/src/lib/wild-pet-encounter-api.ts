import type { Character } from '../types/character';
import type { Pet } from '../types/pet';

/**
 * World-map wild-pet encounters, settled server-side.
 *
 * The explore tile used to roll the encounter locally and hand the new pet to
 * the generic save blob. That silently lost every pet: `sanitizeCharacterSave`
 * (api/save/[name].ts) rejects any pet id the stored save doesn't already have,
 * so the befriended pet lived in client state until the next reload and then
 * vanished. Both halves now go through the dedicated endpoints, which are the
 * only paths allowed to add to the roster:
 *
 *   /api/pet/encounter-start — rolls the wild pet, counts it against the daily
 *     exploration attempts, and mints a single-use token with the pet sealed in.
 *   /api/pet/befriend        — spends the token, rolls the trait, and commits the
 *     pet to the save under the save lock. Returns the persisted character.
 *
 * This is the same pair the Hollow Gate locked-door befriend already uses.
 */

export type WildPetEncounter = { token: string; pet: Pet };

/**
 * Ask the server for this tile's wild-pet roll. Returns null when no pet showed
 * up (the common case — the roll is a ~5% hit), when the daily attempt cap is
 * spent, or when the request fails. Explore then continues to its other
 * outcomes, so a server hiccup costs a possible pet, never the tile.
 */
export async function startWildPetEncounter(playerName: string): Promise<WildPetEncounter | null> {
    try {
        const response = await fetch('/api/pet/encounter-start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName }),
        });
        const data = await response.json().catch(() => null) as { token?: string; pet?: Pet } | null;
        if (!response.ok || !data?.token || !data.pet) return null;
        return { token: data.token, pet: data.pet };
    } catch {
        return null;
    }
}

/**
 * Spend an encounter token and commit the pet. The returned character is the
 * server's persisted copy — adopt it wholesale rather than merging locally, or
 * the next autosave re-submits a roster the sanitizer will strip again.
 */
export async function befriendWildPet(
    playerName: string,
    token: string,
): Promise<{ character?: Character; trait?: string | null; destination?: "roster" | "sanctuary" | null; saveVersion?: number; error?: string }> {
    try {
        const response = await fetch('/api/pet/befriend', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, token }),
        });
        const data = await response.json().catch(() => null) as
            { character?: Character; trait?: string | null; destination?: "roster" | "sanctuary" | null; _saveVersion?: number; error?: string } | null;
        if (!response.ok || !data?.character) {
            return { error: data?.error || 'The pet could not be befriended.' };
        }
        return { character: data.character, trait: data.trait ?? null, destination: data.destination ?? null, saveVersion: data._saveVersion };
    } catch {
        return { error: 'The pet server is unreachable.' };
    }
}
