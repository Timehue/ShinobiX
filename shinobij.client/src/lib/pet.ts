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

// Display name — prefer the user's nickname if set, else the pet's
// canonical name. Trim guards against accidental empty-string nicknames.
export function petDisplayName(pet: Pick<Pet, "name" | "nickname">): string {
    return pet.nickname?.trim() || pet.name;
}

// Clamp happiness into [0, 100]; default to 0 if undefined.
export function petHappiness(pet: Pick<Pet, "happiness">): number {
    return Math.max(0, Math.min(100, Math.floor(pet.happiness ?? 0)));
}

// True if the pet is mid-expedition and hasn't reached its endsAt time.
// A nullish pet (no active selection) is trivially false.
export function isPetOnExpedition(
    pet?: Pick<Pet, "expedition"> | null,
): boolean {
    return Boolean(pet?.expedition && Date.now() < pet.expedition.endsAt);
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

// Pick a deterministic top-N team of available (not on expedition) pets,
// ordered by level (desc) then id (asc) so the choice is stable across
// reloads. Used by the Tactical Arena Fight-AI launcher and the PvP
// challenge to build each side's roster. `size` is the requested team size
// (2 or 4); fewer available pets just yields a smaller team (min 1).
export function pickArenaTeam(pets: Pet[], size: number): Pet[] {
    return pets
        .filter((p) => !isPetOnExpedition(p))
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, Math.max(1, size));
}

// Extract the numeric "variant" suffix from a pet ID like
// "wolf-2" or "wolf-2-mythic" → returns 2. Used by the renderer to pick
// which sprite variant to show so multiple instances of the same template
// don't all share identical art.
export function petVariantIndex(pet: Pick<Pet, "id">): number {
    return Math.max(0, Number(pet.id.match(/-(\d+)(?:-|$)/)?.[1] ?? 0));
}
