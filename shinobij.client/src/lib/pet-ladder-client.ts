/*
 * Client helpers for the global Pet Ladders (api/pet-ladder/ladder.ts). Thin fetch
 * wrappers + the snapshot→Pet reconstruction used to REPLAY a sealed challenge in the
 * 2.5D/3D cinematic. Auth headers are injected by the global authFetch interceptor;
 * the player name travels in the body (the handler also re-checks it against auth).
 */

import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";
import type { RitePlan } from "./pet-warfront-rite";
import { WARFRONT_LADDER_RULES, type WarfrontLadderPlan } from "../../../shared/warfront-ladder-plan";
import type { Pet, PetJutsu } from "../types/pet";

export type Mode = "coliseum" | "tactical";

// A pet frozen by the server (combat fields + loadout). Mirrors api/pet-ladder/_core.ts:LadderPet.
export type LadderPet = {
    id: string; name: string; rarity: string; level: number;
    templateId?: string; evolutionStage?: Pet["evolutionStage"]; paletteVariantId?: string;
    hp: number; attack: number; defense: number; speed: number;
    element: string; trait?: string; role?: ArenaRoleLite;
    subRole?: Pet["subRole"];
    jutsus: PetJutsu[]; loadout?: { pvp?: string; consumable?: string };
};
export type ArenaRoleLite = "defender" | "tracker" | "assassin" | "sage";
export type PetLite = { name: string; element: string; level: number; role?: ArenaRoleLite; rarity: string };

export type LadderListEntry = { rank: number; slug: string; name: string; village?: string; record: { wins: number; losses: number; defended: number; defeated: number }; summary: PetLite[] };
export type LadderNotify = { from: string; mode: Mode; won: boolean; at: number };
export type LadderView = {
    mode: Mode; total: number; ladder: LadderListEntry[];
    you: { rank: number | null; record?: LadderListEntry["record"] | null; hasDefense: boolean; defense: PetLite[] | null; defensePetIds?: string[] | null; challengesLeft: number; band: number; warfrontPlan?: WarfrontLadderPlan };
    notifications: LadderNotify[];
};
export type OfferOpponent = { kind: "player" | "ai"; id: string; name: string; village?: string; rank: number | null; summary: PetLite[] };

export type ChallengeReplay =
    // The server ships its own derived script for a coliseum challenge; the
    // client plays it rather than re-running the fight. Rows stored before the
    // engine cutover still arrive as `coliseum` and are no longer playable —
    // the result banner still stands.
    | { kind: "showdown"; seed: number; player: LadderPet; enemy: LadderPet; script: ShowdownReplayScript }
    | { kind: "coliseum"; seed: number; player: LadderPet; enemy: LadderPet }
    | {
        kind: "warfront"; seed: number;
        blue: Array<{ pet: LadderPet; role: ArenaRoleLite }>; red: Array<{ pet: LadderPet; role: ArenaRoleLite }>;
        bluePlan: RitePlan; redPlan: RitePlan;
    }
    | { kind: "tactical"; seed: number };
export type ChallengeResult = { won: boolean; mode: Mode; targetId: string; rank: number | null; challengesLeft: number; replay: ChallengeReplay };

/** Reconstruct a sim-ready client Pet from a sealed ladder snapshot. */
export function toClientPet(p: LadderPet): Pet {
    return {
        id: p.id, name: p.name, rarity: p.rarity as Pet["rarity"], level: p.level, xp: 0, maxLevel: 100,
        templateId: p.templateId, evolutionStage: p.evolutionStage, paletteVariantId: p.paletteVariantId,
        hp: p.hp, attack: p.attack, defense: p.defense, speed: p.speed,
        element: p.element as Pet["element"], trait: p.trait as Pet["trait"], role: p.role as Pet["role"],
        subRole: p.subRole,
        jutsus: p.jutsus.map((j) => ({ ...j, currentCooldown: j.currentCooldown ?? 0 })),
        unlockedForPve: true,
        ...(p.loadout ? { loadout: p.loadout } : {}),
    } as Pet;
}

/** Old snapshots may have their effective role only on the sealed team slot.
 * The Rite reads Pet.role, so carry the authority's fallback into that field. */
export function toClientWarfrontSlot(slot: { pet: LadderPet; role: ArenaRoleLite }) {
    const role = slot.pet.role ?? slot.role;
    return { pet: { ...toClientPet(slot.pet), role }, role };
}

async function post<T>(name: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch("/api/pet-ladder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...payload, ...(payload.mode === "tactical" ? { warfrontRules: WARFRONT_LADDER_RULES } : {}) }) });
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
/** The historical tactical storage key now seals a Beastbound Warfront formation. */
export const setLadderDefense = (name: string, mode: Mode, petIds: string[], setup?: { warfrontPlan: WarfrontLadderPlan }) =>
    post<{ ok: true; defense: PetLite[]; warfrontPlan?: WarfrontLadderPlan }>(name, { action: "defense", mode, petIds, ...setup });
export const getLadderOffer = (name: string, mode: Mode) => post<{ offer: OfferOpponent[] }>(name, { action: "offer", mode });
export const challengeLadder = (name: string, mode: Mode, targetId: string) => post<ChallengeResult>(name, { action: "challenge", mode, targetId });
export const clearLadderNotify = (name: string) => post<{ ok: true }>(name, { action: "clearNotify" });
