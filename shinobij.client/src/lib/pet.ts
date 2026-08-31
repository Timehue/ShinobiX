/*
 * Pet utility helpers.
 *
 * Pure functions for working with Pet objects — display naming,
 * happiness clamping, expedition status, combat damage formula, etc.
 * No closures, no React, no side effects.
 *
 * The lookup tables (petStatCaps, balancedPetBaseStats, petFeedItems,
 * petElementByName) and their consumers (capPetStats, petFeedXpForItem,
 * balanceBuiltInPetTemplate) stay in App.tsx for now because each one
 * depends on a const table that hasn't moved yet.
 *
 * Extracted from App.tsx.
 */

import type { Pet } from "../types/pet";
import { serverNow } from "./server-clock";
import {
    clampHappiness,
    petHappinessBudgetRemaining,
    settlePetHappinessState,
} from "../../../shared/pet-happiness";

// Display name — prefer the user's nickname if set, else the pet's
// canonical name. Trim guards against accidental empty-string nicknames.
export function petDisplayName(pet: Pick<Pet, "name" | "nickname">): string {
    return pet.nickname?.trim() || pet.name;
}

// Clamp the STORED happiness into [0, 100]; default to 0 if undefined.
//
// This is the raw value as the server last wrote it. For anything the player
// sees or that decides an outcome, prefer petCurrentHappiness below — happiness
// decays at every UTC daily reset, and the stored number is only correct until
// the next rollover. Keeping the two apart is load-bearing: normalizePetTemplate
// writes `happiness: petHappiness(merged)` back onto the local pet, and a
// decay-projecting function there would re-decay an already-decayed value on
// every render (the stamp it decays from lives on the server).
export function petHappiness(pet: Pick<Pet, "happiness">): number {
    return clampHappiness(pet.happiness);
}

// Happiness the pet ACTUALLY has right now: the stored value minus whatever
// daily decay has come due since the server last settled it. Never written back
// onto the pet — the server owns that (see api/pet/_happiness.ts). Use this for
// the meter, for tier/penalty display, and for any client-run fight decision.
export function petCurrentHappiness(
    pet: Pick<Pet, "happiness" | "happinessDay" | "happinessPets">,
    now = serverNow(),
): number {
    return settlePetHappinessState(pet, now).happiness;
}

// Free petting points still available today. 0 means the Pet button will 409.
export function petFreePettingLeft(
    pet: Pick<Pet, "happiness" | "happinessDay" | "happinessPets">,
    now = serverNow(),
): number {
    return petHappinessBudgetRemaining(pet, now);
}

// True if the pet is mid-expedition and hasn't reached its endsAt time.
// A nullish pet (no active selection) is trivially false.
export function isPetOnExpedition(
    pet?: Pick<Pet, "expedition"> | null,
): boolean {
    return Boolean(pet?.expedition && serverNow() < pet.expedition.endsAt);
}

// Combat damage formula used by the pet arena + boss-summon flows.
// Combines raw attack stat with the pet's strongest damage jutsu and a
// small per-level scaling term. Floored at 20 so even level-1 standard
// pets contribute something visible to combat math.
export function petCombatDamage(pet: Pet): number {
    const bestDamageJutsu = Math.max(
        0,
        ...pet.jutsus.filter((jutsu) => jutsu.kind === "damage").map((jutsu) => jutsu.power),
    );
    // All four stats feed the summon's strike: attack + its best damage jutsu
    // are the core, speed (agility) adds bite, and the pet's bulk (hp + def —
    // its battle "presence") chips in a little so every stat matters.
    return Math.max(20, Math.floor(
        pet.attack * 1.25
        + bestDamageJutsu * 0.6
        + pet.speed * 0.35
        + (pet.hp + pet.defense) * 0.025
        + pet.level * 2,
    ));
}

// Returns a new pet with happiness bumped by `amount`, clamped to 100.
export function increasePetHappiness(pet: Pet, amount = 10): Pet {
    return { ...pet, happiness: Math.min(100, petHappiness(pet) + amount) };
}

export type WarfrontPetBusyReason = "breeding" | "training" | "expedition";

export type ColosseumPetBusyReason = "breeding" | "training" | "expedition";

// Mirrors api/pet/showdown.ts. Colosseum only blocks work that is active now;
// completed training and expeditions can be collected later. breedingSessionId
// is intentionally absent: it is permanent lineage provenance on a hatched
// companion, not evidence that the companion is currently in the barn.
export function colosseumPetBusyReason(
    pet: Pick<Pet, "id" | "training" | "expedition">,
    breedingPetIds?: ReadonlySet<string>,
    now = serverNow(),
): ColosseumPetBusyReason | null {
    if (breedingPetIds?.has(pet.id)) return "breeding";
    if (pet.training && now < pet.training.endsAt) return "training";
    if (pet.expedition && now < pet.expedition.endsAt) return "expedition";
    return null;
}

export function isPetAvailableForColosseum(
    pet: Pick<Pet, "id" | "training" | "expedition">,
    breedingPetIds?: ReadonlySet<string>,
    now = serverNow(),
): boolean {
    return colosseumPetBusyReason(pet, breedingPetIds, now) === null;
}

// Mirrors api/pet/_pet-busy.ts exactly for Hollow Warfront admission. A
// completed training or expedition remains busy until its result is collected,
// because the persisted record still exists and the server will reject it.
export function warfrontPetBusyReason(
    pet: Pick<Pet, "id" | "training" | "expedition">,
    breedingPetIds?: ReadonlySet<string>,
): WarfrontPetBusyReason | null {
    if (breedingPetIds?.has(pet.id)) return "breeding";
    if (pet.training) return "training";
    if (pet.expedition) return "expedition";
    return null;
}

export function isPetAvailableForWarfront(
    pet: Pick<Pet, "id" | "training" | "expedition">,
    breedingPetIds?: ReadonlySet<string>,
): boolean {
    return warfrontPetBusyReason(pet, breedingPetIds) === null;
}

// Pick a deterministic top-N team of Warfront-available pets,
// ordered by level (desc) then id (asc) so the choice is stable across
// reloads. Used by the Tactical Arena Fight-AI launcher and the PvP
// challenge to build each side's roster. `size` is the requested team size
// (2 or 4); fewer available pets just yields a smaller team (min 1).
export function pickArenaTeam(
    pets: readonly Pet[],
    size: number,
    priorityPetId?: string | null,
    breedingPetIds?: ReadonlySet<string>,
): Pet[] {
    const ranked = pets
        .filter((pet) => isPetAvailableForWarfront(pet, breedingPetIds))
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const priorityIndex = priorityPetId ? ranked.findIndex((pet) => pet.id === priorityPetId) : -1;
    if (priorityIndex > 0) {
        const [priorityPet] = ranked.splice(priorityIndex, 1);
        ranked.unshift(priorityPet);
    }
    return ranked.slice(0, Math.max(1, size));
}

export const TACTICAL_ARENA_PET_REQUIREMENT = 4;

export function availablePetBattleCount(pets: readonly Pet[]): number {
    return pets.filter((pet) => !isPetOnExpedition(pet)).length;
}

export function availableWarfrontPetCount(pets: readonly Pet[], breedingPetIds?: ReadonlySet<string>): number {
    return pets.filter((pet) => isPetAvailableForWarfront(pet, breedingPetIds)).length;
}

export function canEnterTacticalArena(pets: readonly Pet[], breedingPetIds?: ReadonlySet<string>): boolean {
    return availableWarfrontPetCount(pets, breedingPetIds) >= TACTICAL_ARENA_PET_REQUIREMENT;
}

export function resolveAvailablePetBattlePair(pets: Pet[], ids: readonly string[]): [Pet, Pet] | null {
    const [firstId, secondId] = ids;
    if (ids.length !== 2 || !firstId || !secondId || firstId === secondId) return null;
    const first = pets.find((pet) => pet.id === firstId && !isPetOnExpedition(pet));
    const second = pets.find((pet) => pet.id === secondId && !isPetOnExpedition(pet));
    return first && second ? [first, second] : null;
}

// Extract the numeric "variant" suffix from a pet ID like
// "wolf-2" or "wolf-2-mythic" → returns 2. Used by the renderer to pick
// which sprite variant to show so multiple instances of the same template
// don't all share identical art.
export function petVariantIndex(pet: Pick<Pet, "id">): number {
    return Math.max(0, Number(pet.id.match(/-(\d+)(?:-|$)/)?.[1] ?? 0));
}
