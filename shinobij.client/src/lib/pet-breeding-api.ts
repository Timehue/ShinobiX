import type { Character } from "../types/character";
import type { Pet, PetBreedingSession } from "../types/pet";

type ApiErrorBody = { error?: string; message?: string };

// The breeding routes (api/pet/breeding-start.ts, breeding-hatch.ts) answer
// most refusals with a stable kebab-case code and no message. Those codes are
// for the code, not the player, so each one is shown as a sentence that says
// what to do; a refusal that carries its own message is shown as sent.
const BREEDING_ERROR_COPY: Readonly<Record<string, string>> = {
    "invalid-breeding-request": "That breeding request was incomplete. Choose two parents and try again.",
    "player-save-not-found": "Your save could not be found. Log in again, then reopen the Shinobi Hatchery.",
    "breeding-request-already-completed": "This pairing request was already used. Refresh the Shinobi Hatchery to see its current state.",
    "breeding-starts-disabled": "The Shinobi Hatchery is not accepting new pairings right now. Try again later.",
    "parents-must-be-distinct": "Choose two different companions as parents.",
    "parent-not-owned": "One of those parents is no longer in your roster. Refresh the Shinobi Hatchery and choose again.",
    "element-mismatch": "Both parents must share an element. Choose two companions of the same element.",
    "breeding-request-conflict": "This pairing conflicts with an earlier request. Refresh the Shinobi Hatchery and try again.",
    "invalid-hatch-request": "That hatch request was incomplete. Refresh the Shinobi Hatchery and try again.",
    "breeding-session-not-found": "This egg is no longer in your Shinobi Hatchery. Refresh to see its current state.",
    "egg-not-ready": "The egg is not ready to hatch yet. Wait for its timer to finish, then try again.",
    "hatch-requirements-incomplete": "This egg needs more gameplay time in Sanctuary before it can hatch.",
    "hatch-deferred-active-battle": "Your egg is ready. It will hatch after your current battle finishes.",
    "pairing-produced-no-egg": "This pairing did not produce an egg.",
    "sealed-breeding-result-missing": "This egg's details could not be loaded. Refresh the Shinobi Hatchery and try again.",
    "sealed-breeding-template-missing": "This egg's companion could not be found. Refresh the Shinobi Hatchery and try again.",
};
const UNKNOWN_BREEDING_ERROR = "The Shinobi Hatchery could not complete that request. Refresh and try again.";

function requestSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(12_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function parse<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
    if (!response.ok) {
        const reported = body.message || body.error;
        const copy = !reported ? ""
            : Object.hasOwn(BREEDING_ERROR_COPY, reported) ? BREEDING_ERROR_COPY[reported]
            : /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(reported) ? UNKNOWN_BREEDING_ERROR
            : reported;
        throw new Error(copy || `Your Hatchery request could not be confirmed. Reopen the Hatchery to check the pairing or egg.`);
    }
    return body;
}

export type BreedingStatusResponse = {
    ok: true;
    session: PetBreedingSession | null;
    serverTime: number;
    character?: Character;
    _saveVersion: number;
};

export async function fetchBreedingStatus(playerName: string, signal?: AbortSignal): Promise<BreedingStatusResponse> {
    return parse(await fetch(`/api/pet/breeding/status?playerName=${encodeURIComponent(playerName)}`, { signal: requestSignal(signal), cache: "no-store" }));
}

export async function startPetBreeding(args: {
    playerName: string;
    parent1Id: string;
    parent2Id: string;
    requestId: string;
}): Promise<{ ok: true; session: PetBreedingSession | null; eggProduced: boolean; character: Character; serverTime: number; _saveVersion: number; replayed: boolean }> {
    return parse(await fetch("/api/pet/breeding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: requestSignal(),
    }));
}

export async function advancePetIncubation(playerName: string, activity: { id: string; active: boolean; elapsedMs: number }, signal?: AbortSignal): Promise<BreedingStatusResponse> {
    return parse(await fetch('/api/pet/breeding/status', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, activity }), signal: requestSignal(signal) }));
}

export async function hatchPetBreeding(args: { playerName: string; sessionId: string; acknowledgeReveal?: boolean }): Promise<{ ok: true; pet: Pet; destination: "roster" | "sanctuary"; character: Character; replayed: boolean; _saveVersion: number }> {
    return parse(await fetch("/api/pet/breeding/hatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: requestSignal(),
    }));
}
