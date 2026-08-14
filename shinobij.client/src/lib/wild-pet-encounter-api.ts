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

export type WildPetEncounterResult =
    | { kind: "hit"; requestId: string; token: string; pet: Pet; sector: number; replayed: boolean; worldExploreRequestId?: string }
    | { kind: "miss"; requestId: string; sector: number; replayed: boolean }
    | { kind: "resolved"; requestId: string; sector: number; replayed: boolean; resolution: "explored-miss" | "befriended" | "declined" | "expired" }
    | { kind: "blocked"; error: string; status?: number; retryable: boolean };

/**
 * Ask the server for this tile's wild-pet outcome. Only an explicit `pet:null`
 * response is a miss. Transport failures and incomplete responses block normal
 * exploration so retry can recover the same server-owned discovery.
 */
export async function startWildPetEncounter(playerName: string, sector: number, requestId: string): Promise<WildPetEncounterResult> {
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) {
        return { kind: "blocked", error: "The pet attempt has no stable recovery id.", retryable: false };
    }
    try {
        const response = await fetch('/api/pet/encounter-start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, sector, requestId }),
        });
        const data = await response.json().catch(() => null) as {
            token?: string;
            pet?: Pet | null;
            sector?: number;
            replayed?: boolean;
            requestId?: string;
            worldExploreRequestId?: string;
            resolved?: boolean;
            resolution?: string;
            error?: string;
        } | null;
        if (!response.ok) {
            return {
                kind: "blocked",
                error: data?.error ?? "The wild-pet encounter could not be verified.",
                status: response.status,
                retryable: response.status >= 500 || response.status === 408 || response.status === 425 || response.status === 429,
            };
        }
        const sealedSector = Math.floor(Number(data?.sector));
        const sealedRequestId = typeof data?.requestId === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(data.requestId)
            ? data.requestId
            : "";
        if (!Number.isSafeInteger(sealedSector) || sealedSector < 1) {
            return { kind: "blocked", error: "The pet server omitted the sealed sector.", retryable: true };
        }
        if (!sealedRequestId) return { kind: "blocked", error: "The pet server omitted the recovery id.", retryable: true };
        if (data?.resolved === true
            && (data.resolution === "explored-miss" || data.resolution === "befriended"
                || data.resolution === "declined" || data.resolution === "expired")) {
            return {
                kind: "resolved",
                requestId: sealedRequestId,
                sector: sealedSector,
                replayed: data.replayed === true,
                resolution: data.resolution,
            };
        }
        if (data?.pet === null) {
            return { kind: "miss", requestId: sealedRequestId, sector: sealedSector, replayed: data.replayed === true };
        }
        if (!data?.token || !data.pet) {
            return { kind: "blocked", error: "The pet server returned an incomplete encounter.", retryable: true };
        }
        return {
            kind: "hit",
            requestId: sealedRequestId,
            token: data.token,
            pet: data.pet,
            sector: sealedSector,
            replayed: data.replayed === true,
            ...(data.worldExploreRequestId ? { worldExploreRequestId: data.worldExploreRequestId } : {}),
        };
    } catch {
        return { kind: "blocked", error: "The pet server is unreachable.", retryable: true };
    }
}

/** Resolve Leave on the server; the active discovery remains recoverable until ACK. */
export async function declineWildPetEncounter(
    playerName: string,
    token: string,
): Promise<{ ok: boolean; token?: string; replayed?: boolean; error?: string; retryable: boolean }> {
    try {
        const response = await fetch('/api/pet/encounter-decline', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, token }),
        });
        const data = await response.json().catch(() => null) as
            { ok?: boolean; token?: string; replayed?: boolean; error?: string } | null;
        if (!response.ok || data?.ok !== true || data.token !== token) {
            return {
                ok: false,
                error: data?.error ?? 'The pet encounter could not be released.',
                retryable: response.status >= 500 || response.status === 408 || response.status === 425 || response.status === 429,
            };
        }
        return { ok: true, token, replayed: data.replayed === true, retryable: false };
    } catch {
        return { ok: false, error: 'The pet server is unreachable.', retryable: true };
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
