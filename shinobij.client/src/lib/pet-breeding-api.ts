import type { Character } from "../types/character";
import type { Pet, PetBreedingSession } from "../types/pet";

type ApiErrorBody = { error?: string; message?: string };

async function parse<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
    if (!response.ok) throw new Error(body.message || body.error || `Breeding request failed (${response.status}).`);
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
    return parse(await fetch(`/api/pet/breeding/status?playerName=${encodeURIComponent(playerName)}`, { signal, cache: "no-store" }));
}

export async function startPetBreeding(args: {
    playerName: string;
    parent1Id: string;
    parent2Id: string;
    requestId: string;
}): Promise<{ ok: true; session: PetBreedingSession; character: Character; serverTime: number; _saveVersion: number; replayed: boolean }> {
    return parse(await fetch("/api/pet/breeding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
    }));
}

export async function hatchPetBreeding(args: { playerName: string; sessionId: string }): Promise<{ ok: true; pet: Pet; destination: "roster" | "sanctuary"; character: Character; replayed: boolean; _saveVersion: number }> {
    return parse(await fetch("/api/pet/breeding/hatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
    }));
}
