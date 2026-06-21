/*
 * Client helpers for the global Pet Ladders (api/pet-ladder/ladder.ts). Thin fetch
 * wrappers + the snapshot→Pet reconstruction used to REPLAY a sealed challenge in the
 * 2.5D/3D cinematic. Auth headers are injected by the global authFetch interceptor;
 * the player name travels in the body (the handler also re-checks it against auth).
 */

import type { Pet, PetJutsu } from "../types/pet";

export type Mode = "coliseum" | "tactical";

// A pet frozen by the server (combat fields + loadout). Mirrors api/pet-ladder/_core.ts:LadderPet.
export type LadderPet = {
    id: string; name: string; rarity: string; level: number;
    hp: number; attack: number; defense: number; speed: number;
    element: string; trait?: string; role?: ArenaRoleLite;
    jutsus: PetJutsu[]; loadout?: { pvp?: string; consumable?: string };
};
export type ArenaRoleLite = "defender" | "tracker" | "assassin" | "sage";
export type PetLite = { name: string; element: string; level: number; role?: ArenaRoleLite; rarity: string };

export type LadderListEntry = { rank: number; slug: string; name: string; village?: string; record: { wins: number; losses: number; defended: number; defeated: number }; summary: PetLite[] };
export type LadderNotify = { from: string; mode: Mode; won: boolean; at: number };
export type LadderView = {
    mode: Mode; total: number; ladder: LadderListEntry[];
    you: { rank: number | null; hasDefense: boolean; defense: PetLite[] | null; challengesLeft: number; band: number };
    notifications: LadderNotify[];
};
export type OfferOpponent = { kind: "player" | "ai"; id: string; name: string; village?: string; rank: number | null; summary: PetLite[] };

export type ChallengeReplay =
    | { kind: "coliseum"; seed: number; player: LadderPet; enemy: LadderPet }
    | { kind: "tactical"; seed: number; blue: Array<{ pet: LadderPet; role: ArenaRoleLite }>; red: Array<{ pet: LadderPet; role: ArenaRoleLite }> };
export type ChallengeResult = { won: boolean; mode: Mode; targetId: string; rank: number | null; challengesLeft: number; replay: ChallengeReplay };

/** Reconstruct a sim-ready client Pet from a sealed ladder snapshot. */
export function toClientPet(p: LadderPet): Pet {
    return {
        id: p.id, name: p.name, rarity: p.rarity as Pet["rarity"], level: p.level, xp: 0, maxLevel: 100,
        hp: p.hp, attack: p.attack, defense: p.defense, speed: p.speed,
        element: p.element as Pet["element"], trait: p.trait as Pet["trait"], role: p.role as Pet["role"],
        jutsus: p.jutsus.map((j) => ({ ...j, currentCooldown: j.currentCooldown ?? 0 })),
        unlockedForPve: true,
        ...(p.loadout ? { loadout: p.loadout } : {}),
    } as Pet;
}

async function post<T>(name: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch("/api/pet-ladder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...payload }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    return data as T;
}

export async function fetchLadder(name: string, mode: Mode, top?: number): Promise<LadderView> {
    const q = new URLSearchParams({ mode, name, ...(top ? { top: String(top) } : {}) });
    const res = await fetch(`/api/pet-ladder?${q.toString()}`, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    return data as LadderView;
}
export const setLadderDefense = (name: string, mode: Mode, petIds: string[]) => post<{ ok: true; defense: PetLite[] }>(name, { action: "defense", mode, petIds });
export const getLadderOffer = (name: string, mode: Mode) => post<{ offer: OfferOpponent[] }>(name, { action: "offer", mode });
export const challengeLadder = (name: string, mode: Mode, targetId: string) => post<ChallengeResult>(name, { action: "challenge", mode, targetId });
export const clearLadderNotify = (name: string) => post<{ ok: true }>(name, { action: "clearNotify" });
