/*
 * Starter-pet evolution — CLIENT mirror of the authoritative server spec
 * (api/pet/_evolution.ts). Holds the display data (stage names + flavor), the
 * level gates / required items / stat deltas, the evolved POOL TEMPLATES
 * (STARTER_EVOLUTIONS — admin-editable, art-source, wild-locked), and a pure
 * client-side `evolvePet` used for preview math.
 *
 * KEEP IN SYNC with api/pet/_evolution.ts — same pattern as professionLogic ⇄
 * api/missions/_progress. The SERVER is the source of truth for the actual
 * mutation; this mirror only drives UI (the "next form / requirements" panel)
 * and the pool templates. See docs/pet-starter-evolution-plan.md.
 *
 * The 5 starters evolve twice:
 *   Standard ──(Lv 50 + Awakening Stone)──▶ Rare ──(Lv 90 + Ascension Stone)──▶ Legendary
 *
 * The player's evolved pet keeps its persistent `id` (e.g. `starter-fire`); the
 * stage is tracked by `evolutionStage`. These TEMPLATE ids carry a `-r`/`-l`
 * visual suffix only so the admin Pet Editor + shared-image hydration can give
 * each stage its own art (`pet:starter-fire-r`, …). Because they start with
 * `starter-` they are also wild-locked (isWildSpawnable).
 */

import type { Pet, PetRarity } from "../types/pet";
import type { JutsuElement } from "../types/core";
import { STARTER_PETS } from "./starter-pets";

export const AWAKENING_STONE_ID = "evo-stone-awakening";
export const ASCENSION_STONE_ID = "evo-stone-ascension";

/** Display names for the evolution stones (for UI requirement hints). */
export const EVOLUTION_STONE_NAMES: Record<string, string> = {
    [AWAKENING_STONE_ID]: "Awakening Stone",
    [ASCENSION_STONE_ID]: "Ascension Stone",
};

export type EvolveStage = 1 | 2;

export type EvolutionStatDelta = {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    moveRange: number;
};

export type EvolutionStageSpec = {
    stage: EvolveStage;
    name: string;
    rarity: Extract<PetRarity, "rare" | "legendary">;
    requiredLevel: number;
    requiredItem: string;
    delta: EvolutionStatDelta;
    description: string;
};

export type EvolutionLine = {
    baseId: string;
    element: JutsuElement;
    stages: Record<EvolveStage, EvolutionStageSpec>;
};

// MIRROR of api/pet/_evolution.ts — the tier-gap stat deltas. Evolution ADDS the
// delta with no cap clamp: HP/ATK/DEF/SPD are uncapped (training builds them up to
// the level-100 ceiling), and evolving raises the rarity, which raises the
// jutsu-power cap — the higher tier's edge.
const RARE_DELTA: EvolutionStatDelta = { hp: 50, attack: 8, defense: 6, speed: 6, moveRange: 0 };
const LEGENDARY_DELTA: EvolutionStatDelta = { hp: 46, attack: 6, defense: 4, speed: 5, moveRange: 1 };

type LineCopy = { rareName: string; legendaryName: string; rareDesc: string; legendaryDesc: string };

const LINE_COPY: Record<string, LineCopy> = {
    "starter-fire": {
        rareName: "Ember Wolf",
        legendaryName: "Inferno Fenrir",
        rareDesc: "The cub has grown into a lean wolf wreathed in living embers.",
        legendaryDesc: "A towering fire-beast whose every breath warps the air into flame.",
    },
    "starter-water": {
        rareName: "Tidal Selkie",
        legendaryName: "Abyssal Leviathan",
        rareDesc: "The seal pup has matured into a graceful selkie that rides the tide.",
        legendaryDesc: "A deep-sea leviathan that drags the ocean's weight into every blow.",
    },
    "starter-wind": {
        rareName: "Storm Hawk",
        legendaryName: "Tempest Roc",
        rareDesc: "The fledgling is now a storm hawk that carves the sky at will.",
        legendaryDesc: "A colossal roc whose wingbeats summon screaming gales.",
    },
    "starter-lightning": {
        rareName: "Bolt Fang",
        legendaryName: "Raijin Hound",
        rareDesc: "The pup crackles with a current it has finally learned to wield.",
        legendaryDesc: "A thunder-god's hound — each bite lands a clap of lightning.",
    },
    "starter-earth": {
        rareName: "Granite Tortoise",
        legendaryName: "Mountain Genbu",
        rareDesc: "The little tortoise now carries a shell of solid granite.",
        legendaryDesc: "The black tortoise of legend — a walking mountain that cannot be moved.",
    },
};

function buildLine(baseId: string, element: JutsuElement): EvolutionLine {
    const copy = LINE_COPY[baseId];
    return {
        baseId,
        element,
        stages: {
            1: { stage: 1, name: copy.rareName, rarity: "rare", requiredLevel: 50, requiredItem: AWAKENING_STONE_ID, delta: RARE_DELTA, description: copy.rareDesc },
            2: { stage: 2, name: copy.legendaryName, rarity: "legendary", requiredLevel: 90, requiredItem: ASCENSION_STONE_ID, delta: LEGENDARY_DELTA, description: copy.legendaryDesc },
        },
    };
}

export const EVOLUTION_LINES: Record<string, EvolutionLine> = Object.fromEntries(
    STARTER_PETS.map((option) => [option.pet.id, buildLine(option.pet.id, option.element)]),
);

/** Evolution line for a pet by its persistent base id (null if not a starter). */
export function evolutionLineFor(petId: string): EvolutionLine | null {
    return EVOLUTION_LINES[petId] ?? null;
}

/** Map a rarity to the stage it represents (starters only). */
export function stageFromRarity(rarity: PetRarity | undefined): 0 | 1 | 2 {
    if (rarity === "legendary") return 2;
    if (rarity === "rare") return 1;
    return 0;
}

/** A pet's current evolution stage — explicit field wins, else inferred. */
export function currentStage(pet: Pick<Pet, "evolutionStage" | "rarity">): 0 | 1 | 2 {
    const explicit = pet.evolutionStage;
    if (explicit === 0 || explicit === 1 || explicit === 2) return explicit;
    return stageFromRarity(pet.rarity);
}

/** The next evolution available for a pet, or null if none / fully evolved. */
export function nextEvolution(pet: Pick<Pet, "id" | "evolutionStage" | "rarity">): EvolutionStageSpec | null {
    const line = evolutionLineFor(pet.id);
    if (!line) return null;
    const stage = currentStage(pet);
    if (stage >= 2) return null;
    return line.stages[(stage + 1) as EvolveStage];
}

const addStat = (value: number, delta: number): number => Math.max(1, Math.round(value + delta));

/**
 * Pure preview of the evolved pet. MIRRORS api/pet/_evolution.ts evolvePet — the
 * server still owns the authoritative mutation; this is for UI preview only.
 */
export function evolvePet(pet: Pet, nextStage: EvolveStage, line: EvolutionLine): Pet {
    const spec = line.stages[nextStage];
    return {
        ...pet,
        name: spec.name,
        rarity: spec.rarity,
        evolutionStage: nextStage,
        hp: addStat(pet.hp || 0, spec.delta.hp),
        attack: addStat(pet.attack || 0, spec.delta.attack),
        defense: addStat(pet.defense || 0, spec.delta.defense),
        speed: addStat(pet.speed || 0, spec.delta.speed),
        moveRange: Math.max(2, Math.min(5, (pet.moveRange || 3) + spec.delta.moveRange)),
        unlockedForPve: true,
    };
}

/**
 * The visual id for a starter at a given stage — used for stage-specific art
 * lookups (poses / shared images) WITHOUT changing the pet's persistent id.
 *   stage 0 → starter-fire      stage 1 → starter-fire-r      stage 2 → starter-fire-l
 */
export function petVisualId(pet: Pick<Pet, "id" | "evolutionStage" | "rarity">): string {
    if (!evolutionLineFor(pet.id)) return pet.id;
    const stage = currentStage(pet);
    return stage === 1 ? `${pet.id}-r` : stage === 2 ? `${pet.id}-l` : pet.id;
}

/**
 * The evolved POOL TEMPLATES (2 per starter = 10). They exist in the pet pool
 * ONLY so the admin Pet Editor can image them and shared-image hydration can
 * serve each stage's art; `wildSpawnable: false` (plus the `starter-` id prefix)
 * keeps them out of every wild encounter. NOT owned by players — a player's
 * starter keeps its base id and is upgraded in place by /api/pet/evolve.
 */
export const STARTER_EVOLUTIONS: Pet[] = STARTER_PETS.flatMap((option) => {
    const base = option.pet;
    const line = EVOLUTION_LINES[base.id];
    const rare = evolvePet(base, 1, line);
    const legendary = evolvePet({ ...rare, id: base.id }, 2, line);
    const template = (stage: EvolveStage, pet: Pet, suffix: "r" | "l"): Pet => ({
        ...pet,
        id: `${base.id}-${suffix}`,
        level: line.stages[stage].requiredLevel,
        xp: 0,
        wildSpawnable: false,
        description: line.stages[stage].description,
    });
    return [template(1, rare, "r"), template(2, legendary, "l")];
});
