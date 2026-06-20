/**
 * Starter-pet evolution — the AUTHORITATIVE spec + pure stat math.
 *
 * The 5 starter companions evolve twice, climbing one rarity tier each time:
 *   Standard ──(Lv 50 + Awakening Stone)──▶ Rare ──(Lv 90 + Ascension Stone)──▶ Legendary
 *
 * This module is the single source of truth for: which pet evolves into what,
 * the level gate, the required item, and the stat bump. `api/pet/evolve.ts`
 * imports it; the client mirrors the display half in
 * `shinobij.client/src/data/pet-evolutions.ts` (keep the two in sync — same
 * pattern as professionLogic ⇄ api/missions/_progress).
 *
 * Design (see docs/pet-starter-evolution-plan.md):
 *  - The pet's persistent `id` NEVER changes across stages (so the client
 *    normalizer keeps ignoring `starter-*` and won't revert the new rarity).
 *    The stage is tracked by `evolutionStage` (0=standard, 1=rare, 2=legendary).
 *  - The one-time stat bump equals the gap between the rarity base templates
 *    (shinobij.client/src/data/pet-stats.ts), applied ON TOP of the pet's
 *    current stats, then clamped to the new rarity's caps. This makes an evolved
 *    starter equivalent to a native pet of that rarity — no balance outlier.
 *  - `element` is preserved verbatim (carried through the spread), so the
 *    Fire>Wind>Lightning>Earth>Water>Fire matchup wheel survives all 3 stages.
 *  - Jutsu kits are unchanged (kit upgrades are a deliberate, separate, balance-
 *    sensitive decision — not part of this mechanic).
 */

export type EvolveStage = 1 | 2;
export type PetStage = 0 | 1 | 2;
export type EvolvedRarity = 'rare' | 'legendary';

export interface StatDelta {
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    moveRange: number;
}

export interface EvolutionStageSpec {
    stage: EvolveStage;
    /** New display name for this stage. */
    name: string;
    /** Rarity tier this stage promotes the pet to. */
    rarity: EvolvedRarity;
    /** Minimum pet level required to perform this evolution. */
    requiredLevel: number;
    /** Inventory item id consumed by this evolution (one is removed). */
    requiredItem: string;
    /** One-time additive stat bump applied at this evolution. */
    delta: StatDelta;
}

export interface EvolutionLine {
    baseId: string;
    element: string;
    stages: Record<EvolveStage, EvolutionStageSpec>;
}

// Tier-gap deltas (rare-base − standard-base, then legendary-base − rare-base).
// Identical across all 5 elements — only the names differ.
const RARE_DELTA: StatDelta = { hp: 50, attack: 8, defense: 6, speed: 6, moveRange: 0 };
const LEGENDARY_DELTA: StatDelta = { hp: 46, attack: 6, defense: 4, speed: 5, moveRange: 1 };

const AWAKENING_STONE = 'evo-stone-awakening';
const ASCENSION_STONE = 'evo-stone-ascension';

function line(baseId: string, element: string, rareName: string, legendaryName: string): EvolutionLine {
    return {
        baseId,
        element,
        stages: {
            1: { stage: 1, name: rareName, rarity: 'rare', requiredLevel: 50, requiredItem: AWAKENING_STONE, delta: RARE_DELTA },
            2: { stage: 2, name: legendaryName, rarity: 'legendary', requiredLevel: 90, requiredItem: ASCENSION_STONE, delta: LEGENDARY_DELTA },
        },
    };
}

export const EVOLUTION_LINES: Record<string, EvolutionLine> = {
    'starter-fire': line('starter-fire', 'Fire', 'Ember Wolf', 'Inferno Fenrir'),
    'starter-water': line('starter-water', 'Water', 'Tidal Selkie', 'Abyssal Leviathan'),
    'starter-wind': line('starter-wind', 'Wind', 'Storm Hawk', 'Tempest Roc'),
    'starter-lightning': line('starter-lightning', 'Lightning', 'Bolt Fang', 'Raijin Hound'),
    'starter-earth': line('starter-earth', 'Earth', 'Granite Tortoise', 'Mountain Genbu'),
};

/** Look up the evolution line for a pet by its persistent base id. */
export function evolutionLineFor(petId: string): EvolutionLine | null {
    return EVOLUTION_LINES[petId] ?? null;
}

/** Map a rarity string to the evolution stage it represents (starters only). */
export function stageFromRarity(rarity: unknown): PetStage {
    if (rarity === 'legendary') return 2;
    if (rarity === 'rare') return 1;
    return 0;
}

/** The pet's current evolution stage — explicit field wins, else inferred. */
export function currentStage(pet: { evolutionStage?: unknown; rarity?: unknown }): PetStage {
    const explicit = Number(pet.evolutionStage);
    if (explicit === 0 || explicit === 1 || explicit === 2) return explicit;
    return stageFromRarity(pet.rarity);
}

export interface PetLike {
    id?: unknown;
    rarity?: unknown;
    level?: unknown;
    hp?: unknown;
    attack?: unknown;
    defense?: unknown;
    speed?: unknown;
    moveRange?: unknown;
    evolutionStage?: unknown;
    [k: string]: unknown;
}

export interface EvolveCheck {
    ok: boolean;
    /** Stable machine-readable reason when ok === false. */
    code?: 'not-evolvable' | 'max-evolved' | 'level-too-low' | 'wrong-tier' | 'missing-item';
    message?: string;
    nextStage?: EvolveStage;
    spec?: EvolutionStageSpec;
    line?: EvolutionLine;
}

/**
 * Validate whether `pet` can perform its next evolution given an inventory.
 * Pure — no I/O. The endpoint calls this inside the save lock, then applies
 * `evolvePet` only when ok.
 */
export function checkEvolve(pet: PetLike, inventory: string[]): EvolveCheck {
    const id = String(pet.id ?? '');
    const evoLine = evolutionLineFor(id);
    if (!evoLine) return { ok: false, code: 'not-evolvable', message: 'This pet cannot evolve.' };

    const stage = currentStage(pet);
    if (stage >= 2) return { ok: false, code: 'max-evolved', message: 'This pet is already fully evolved.' };

    const nextStage = (stage + 1) as EvolveStage;
    const spec = evoLine.stages[nextStage];

    const level = Math.floor(Number(pet.level ?? 1));
    if (level < spec.requiredLevel) {
        return { ok: false, code: 'level-too-low', message: `Requires level ${spec.requiredLevel}.`, nextStage, spec, line: evoLine };
    }

    // Belt-and-suspenders: the pre-evolution rarity must match the stage we
    // think we're at (guards a tampered save where rarity and stage disagree).
    const expectedRarity = nextStage === 1 ? 'standard' : 'rare';
    if (String(pet.rarity ?? 'standard') !== expectedRarity) {
        return { ok: false, code: 'wrong-tier', message: 'Pet is not at the expected evolution tier.', nextStage, spec, line: evoLine };
    }

    if (!inventory.includes(spec.requiredItem)) {
        return { ok: false, code: 'missing-item', message: `Missing required item (${spec.requiredItem}).`, nextStage, spec, line: evoLine };
    }

    return { ok: true, nextStage, spec, line: evoLine };
}

const addStat = (value: number, delta: number): number => Math.max(1, Math.round(value + delta));

/**
 * Pure evolution transform. Returns a NEW pet object with the next stage's
 * name/rarity/stage and the stat bump ADDED (no cap clamp — HP/ATK/DEF/SPD are
 * uncapped now that training builds them to the level-100 ceiling; evolving raises
 * the rarity, which raises the jutsu-power cap, the higher tier's edge). id,
 * element, xp, happiness, loadout, jutsus and everything else are carried verbatim.
 *
 * Callers must validate with `checkEvolve` first — this does no gating.
 */
export function evolvePet<T extends PetLike>(pet: T, nextStage: EvolveStage, evoLine: EvolutionLine): T {
    const spec = evoLine.stages[nextStage];
    return {
        ...pet,
        name: spec.name,
        rarity: spec.rarity,
        evolutionStage: nextStage,
        hp: addStat(Number(pet.hp) || 0, spec.delta.hp),
        attack: addStat(Number(pet.attack) || 0, spec.delta.attack),
        defense: addStat(Number(pet.defense) || 0, spec.delta.defense),
        speed: addStat(Number(pet.speed) || 0, spec.delta.speed),
        moveRange: Math.max(2, Math.min(5, (Number(pet.moveRange) || 3) + spec.delta.moveRange)),
        unlockedForPve: true,
    } as T;
}
