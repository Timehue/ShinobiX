import type { Character } from '../types/character';
import type { Pet } from '../types/pet';
import { runSingleFlight } from './single-flight';

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
 *   /api/pet/wild-binding    — runs the server battle and spends a seal on a
 *     capture attempt. Success commits the normal pet to the save.
 *   /api/pet/befriend        — legacy/special encounter compatibility only.
 *
 * Hollow Gate's locked-door befriend retains its separate authored path.
 */

export type WildPetEncounterResult =
    | { kind: "hit"; requestId: string; token: string; pet: Pet; sector: number; replayed: boolean; worldExploreRequestId?: string }
    | { kind: "miss"; requestId: string; sector: number; replayed: boolean }
    | { kind: "resolved"; requestId: string; sector: number; replayed: boolean; resolution: "explored-miss" | "befriended" | "declined" | "expired" }
    | { kind: "blocked"; error: string; status?: number; retryable: boolean; reason?: string; pendingDungeon?: { requestId: string; sector: number } };

export function wildPetEncounterFailureMessage(result: Extract<WildPetEncounterResult, { kind: "blocked" }>): string {
    if (result.reason === "daily-limit") return "Daily wild-pet search limit reached (150/150). Resets at midnight UTC.";
    if (result.status === 401) return "Your session needs to reconnect. Sign in again, then explore to recover your saved attempt.";
    if (!result.retryable) return result.error;
    if (result.status === 429) return "Too many exploration requests. Wait a moment, then try again; your saved attempt will be reused.";
    return result.error + " Try exploring again; your saved attempt will be reused.";
}

const pendingWildPetSearches = new Map<string, Promise<WildPetEncounterResult>>();

/**
 * Ask the server for this tile's wild-pet outcome. Only an explicit `pet:null`
 * response is a miss. Transport failures and incomplete responses block normal
 * exploration so retry can recover the same server-owned discovery.
 */
export async function startWildPetEncounter(playerName: string, sector: number, requestId: string, caravanId?: string): Promise<WildPetEncounterResult> {
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) {
        return { kind: "blocked", error: "The pet attempt has no stable recovery id.", retryable: false };
    }
    const key = JSON.stringify([playerName, sector, requestId, caravanId ?? ""]);
    const pending = pendingWildPetSearches.get(key);
    if (pending) return pending;
    // Map-open recovery and a quick Explore click can ask for the same result.
    // Share one request/retry sequence instead of contending on its server lock.
    const search = retryWildPetEncounter(playerName, sector, requestId, caravanId);
    pendingWildPetSearches.set(key, search);
    try {
        return await search;
    } finally {
        pendingWildPetSearches.delete(key);
    }
}

async function retryWildPetEncounter(playerName: string, sector: number, requestId: string, caravanId?: string): Promise<WildPetEncounterResult> {
    for (let attempt = 0; ; attempt++) {
        const result = await requestWildPetEncounter(playerName, sector, requestId, caravanId);
        // Replay this exact id after a lost ACK without rerolling or spending
        // another attempt. Do not hammer throttling or auth refusals.
        const transient = result.kind === "blocked" && result.retryable
            && (result.status === undefined || result.status >= 500 || result.status === 408
                || result.status === 425 || result.reason === "no-presence");
        if (!transient || attempt >= 2) return result;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
}

async function requestWildPetEncounter(playerName: string, sector: number, requestId: string, caravanId?: string): Promise<WildPetEncounterResult> {
    try {
        const response = await fetch('/api/pet/encounter-start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, sector, requestId, ...(caravanId ? { caravanRunId: caravanId } : {}) }),
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
            reason?: string;
        } | null;
        if (!response.ok) {
            // Support the older daily-cap response during a rolling deploy.
            const reason = data?.reason ?? (response.status === 429 && data?.error === "Daily exploration limit reached."
                ? "daily-limit" : undefined);
            const pendingDungeon = reason === "pending-dungeon-discovery"
                && typeof data?.requestId === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(data.requestId)
                && Number.isSafeInteger(data.sector) && data.sector! >= 1 && data.sector! <= 66
                ? { requestId: data.requestId, sector: data.sector! } : undefined;
            return {
                kind: "blocked",
                error: data?.error ?? "The wild-pet encounter could not be verified.",
                status: response.status,
                retryable: reason !== "daily-limit" && (response.status >= 500 || response.status === 401
                    || response.status === 408 || response.status === 425 || response.status === 429
                    || reason === "no-presence" || reason === "pending-dungeon-discovery"),
                ...(reason ? { reason } : {}),
                ...(pendingDungeon ? { pendingDungeon } : {}),
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

type PetChoiceFailure = { error?: string; status?: number; retryable?: boolean };
type DeclineWildPetResult = PetChoiceFailure & { ok: boolean; token?: string; replayed?: boolean; retryable: boolean };
type BefriendWildPetResult = PetChoiceFailure & { character?: Character; trait?: string | null; destination?: "roster" | "sanctuary" | null; saveVersion?: number };
const pendingPetDeclines = new Map<string, Promise<DeclineWildPetResult>>();
const pendingPetBefriends = new Map<string, Promise<BefriendWildPetResult>>();

async function retryPetChoice<Result extends PetChoiceFailure>(request: () => Promise<Result>): Promise<Result> {
    for (let attempt = 0; ; attempt++) {
        const result = await request();
        const transient = result.retryable === true && (result.status === undefined
            || result.status >= 500 || result.status === 408 || result.status === 425
            || (result.status >= 200 && result.status < 300));
        if (!transient || attempt >= 2) return result;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
}

function retryablePetChoiceStatus(status: number): boolean {
    return status >= 500 || status === 401 || status === 408 || status === 425 || status === 429;
}

function petChoiceError(status: number, error: string | undefined, fallback: string): string {
    return status === 401
        ? 'Your session needs to reconnect. Sign in again, then retry your pet choice.'
        : error || fallback;
}

/** Resolve Leave on the server; the active discovery remains recoverable until ACK. */
export async function declineWildPetEncounter(playerName: string, token: string): Promise<DeclineWildPetResult> {
    return runSingleFlight(pendingPetDeclines, JSON.stringify([playerName, token]),
        () => retryPetChoice(() => requestPetDecline(playerName, token)));
}

async function requestPetDecline(playerName: string, token: string): Promise<DeclineWildPetResult> {
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
                error: petChoiceError(response.status, data?.error, 'The pet encounter could not be released.'),
                status: response.status,
                // Missing or malformed success ACKs do not prove that Leave
                // failed. Keep the same choice/token and replay it safely.
                retryable: response.ok || retryablePetChoiceStatus(response.status),
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
export async function befriendWildPet(playerName: string, token: string): Promise<BefriendWildPetResult> {
    return runSingleFlight(pendingPetBefriends, JSON.stringify([playerName, token]),
        () => retryPetChoice(() => requestPetBefriend(playerName, token)));
}

async function requestPetBefriend(playerName: string, token: string): Promise<BefriendWildPetResult> {
    try {
        const response = await fetch('/api/pet/befriend', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, token }),
        });
        const data = await response.json().catch(() => null) as
            { character?: Character; trait?: string | null; destination?: "roster" | "sanctuary" | null; _saveVersion?: number; error?: string } | null;
        if (!response.ok || !data?.character || typeof data.character !== 'object' || Array.isArray(data.character)) {
            return {
                error: petChoiceError(response.status, data?.error, 'The pet could not be befriended.'),
                status: response.status,
                retryable: response.ok || retryablePetChoiceStatus(response.status),
            };
        }
        return { character: data.character, trait: data.trait ?? null, destination: data.destination ?? null, saveVersion: data._saveVersion };
    } catch {
        return { error: 'The pet server is unreachable.', retryable: true };
    }
}
