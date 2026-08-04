import type { Character } from "../types/character";
import type { Pet } from "../types/pet";

type ApiErrorBody = { error?: string; message?: string };

async function parse<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
    if (!response.ok) throw new Error(body.message || body.error || `Sanctuary request failed (${response.status}).`);
    return body;
}

export type PetSanctuarySource = "wild" | "bred" | "roster";

export type PetSanctuaryItem = {
    schemaVersion: 1;
    pet: Pet;
    page: number;
    storedAt: number;
    source: PetSanctuarySource;
};

export type PetSanctuaryFilters = {
    search?: string;
    element?: string;
    rarity?: string;
    origin?: string;
};

export type PetSanctuaryListResponse = {
    ok: true;
    items: PetSanctuaryItem[];
    total: number;
    nextCursor: string | null;
    carriedCount: number;
    carriedCapacity: number;
};

export async function fetchPetSanctuary(
    playerName: string,
    filters: PetSanctuaryFilters = {},
    cursor?: string | null,
    signal?: AbortSignal,
): Promise<PetSanctuaryListResponse> {
    const query = new URLSearchParams({ playerName, limit: "24" });
    if (cursor) query.set("cursor", cursor);
    if (filters.search?.trim()) query.set("search", filters.search.trim());
    if (filters.element && filters.element !== "all") query.set("element", filters.element);
    if (filters.rarity && filters.rarity !== "all") query.set("rarity", filters.rarity);
    if (filters.origin && filters.origin !== "all") query.set("origin", filters.origin);
    return parse(await fetch(`/api/pet/sanctuary/list?${query}`, { cache: "no-store", signal }));
}

export type PetSanctuaryAction = "to-sanctuary" | "to-roster" | "release";

export async function transferPetSanctuary(args: {
    playerName: string;
    petId: string;
    action: PetSanctuaryAction;
}): Promise<{ ok: true; action: PetSanctuaryAction; replayed: boolean; pet: Pet; character: Character; _saveVersion: number }> {
    return parse(await fetch("/api/pet/sanctuary/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
    }));
}
