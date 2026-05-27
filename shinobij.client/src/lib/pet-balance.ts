/*
 * Pet balancing + training + XP helpers.
 *
 * Pure pet-stat math: clamp stats to per-rarity caps, balance built-in
 * templates against the central stat table, roll traits, run training,
 * level up, clone for an encounter, and scale event boss pets by
 * difficulty.
 *
 * No closures, no app state — every function takes its inputs as args
 * and returns a fresh Pet. The pet stat tables + element lookup + happiness
 * helper come from sibling data/ + lib/ modules.
 *
 * Extracted from App.tsx.
 */

import type { Pet, PetRarity, PetTrait, PetTrainingType, PetJutsu } from "../types/pet";
import type { JutsuElement } from "../types/core";
import { balancedPetBaseStats, petStatCaps } from "../data/pet-stats";
import {
    petTraits,
    petTrainingDurations,
    petTrainingDurationMultipliers,
} from "../data/pet-config";
import { petElementByName } from "../data/pet-elements";
import { petHappiness, increasePetHappiness, petVariantIndex } from "./pet";

// ── Per-rarity stat clamp ───────────────────────────────────────────────

/**
 * Clamp every numeric pet stat to its per-rarity ceiling. Jutsu power
 * is similarly clamped per-rarity (0-power slots are left alone so
 * utility jutsus stay utility). moveRange is bounded to [2, 5].
 */
export function capPetStats(pet: Pet): Pet {
    const caps = petStatCaps[pet.rarity] ?? petStatCaps.standard;
    return {
        ...pet,
        hp: Math.min(caps.hp, Math.max(1, Math.round(pet.hp))),
        attack: Math.min(caps.attack, Math.max(1, Math.round(pet.attack))),
        defense: Math.min(caps.defense, Math.max(1, Math.round(pet.defense))),
        speed: Math.min(caps.speed, Math.max(1, Math.round(pet.speed))),
        jutsus: pet.jutsus.map((jutsu) => ({
            ...jutsu,
            power: jutsu.power > 0 ? Math.min(caps.jutsuPower, Math.max(1, Math.round(jutsu.power))) : 0,
        })),
        moveRange: Math.max(2, Math.min(5, Math.round(pet.moveRange ?? balancedPetBaseStats[pet.rarity]?.moveRange ?? 3))),
    };
}

// ── Elemental special jutsu (one signature jutsu per pet) ───────────────
// Element drives the effect kind; rarity drives the strength.
//   Fire     → burn    (DoT + ATK debuff)
//   Water    → freeze  (50% turn skip)
//   Wind     → confuse (50% self-hit)
//   Lightning→ stun    (guaranteed turn skip)
//   Earth    → crush   (direct hit + bigger stat strip)
// Durations are capped (burn/freeze/confuse max 2 rounds; stun max 1) so
// no tier can lock an opponent out for 3 full rounds.

export type ElementalSpecialKind = "burn" | "freeze" | "confuse" | "stun" | "crush";

const elementalSpecialKind: Record<Exclude<JutsuElement, "None">, ElementalSpecialKind> = {
    Fire: "burn",
    Water: "freeze",
    Wind: "confuse",
    Lightning: "stun",
    Earth: "crush",
};

export type ElementalSpecialSpec = { name: string; power: number; cooldown: number; rounds: number };

const elementalSpecialByRarityElement: Record<PetRarity, Record<Exclude<JutsuElement, "None">, ElementalSpecialSpec>> = {
    standard: {
        Fire:      { name: "Searing Mark",        power: 40,  cooldown: 5, rounds: 2 },
        Water:     { name: "Frost Bite",          power: 40,  cooldown: 5, rounds: 1 },
        Wind:      { name: "Whirling Daze",       power: 40,  cooldown: 5, rounds: 1 },
        Lightning: { name: "Static Snap",         power: 40,  cooldown: 5, rounds: 1 },
        Earth:     { name: "Heavy Stone",         power: 40,  cooldown: 5, rounds: 0 },
    },
    rare: {
        Fire:      { name: "Ember Lash",          power: 60,  cooldown: 5, rounds: 2 },
        Water:     { name: "Frozen Lash",         power: 60,  cooldown: 5, rounds: 2 },
        Wind:      { name: "Cyclone Veil",        power: 60,  cooldown: 5, rounds: 2 },
        Lightning: { name: "Shock Sigil",         power: 60,  cooldown: 5, rounds: 1 },
        Earth:     { name: "Boulder Press",       power: 65,  cooldown: 5, rounds: 0 },
    },
    legendary: {
        Fire:      { name: "Pyre Burst",          power: 75,  cooldown: 5, rounds: 2 },
        Water:     { name: "Glacial Coffin",      power: 72,  cooldown: 5, rounds: 2 },
        Wind:      { name: "Tempest Mirage",      power: 72,  cooldown: 5, rounds: 2 },
        Lightning: { name: "Thunderbreak",        power: 75,  cooldown: 5, rounds: 1 },
        Earth:     { name: "Mountain Crush",      power: 82,  cooldown: 5, rounds: 0 },
    },
    mythic: {
        Fire:      { name: "Solar Conflagration", power: 90,  cooldown: 5, rounds: 2 },
        Water:     { name: "Eternal Glacier",     power: 85,  cooldown: 5, rounds: 2 },
        Wind:      { name: "Heaven's Vortex",     power: 85,  cooldown: 5, rounds: 2 },
        Lightning: { name: "Worldfall Bolt",      power: 88,  cooldown: 5, rounds: 1 },
        Earth:     { name: "World-Ender Slab",    power: 100, cooldown: 5, rounds: 0 },
    },
};

/** Pull an elemental special jutsu spec for a (element, rarity) pair. */
export function elementalSpecialFor(element: JutsuElement | undefined, rarity: PetRarity): PetJutsu | null {
    if (!element || element === "None") return null;
    const tierTable = elementalSpecialByRarityElement[rarity] ?? elementalSpecialByRarityElement.standard;
    const spec = tierTable[element as Exclude<JutsuElement, "None">];
    if (!spec) return null;
    return {
        name: spec.name,
        power: spec.power,
        cooldown: spec.cooldown,
        currentCooldown: 0,
        kind: elementalSpecialKind[element as Exclude<JutsuElement, "None">],
        ...(spec.rounds > 0 ? { rounds: spec.rounds } : {}),
    };
}

// ── Built-in template balancing ─────────────────────────────────────────

/**
 * Scale a built-in pet template against the central balanced stat table.
 * Variant index (extracted from the template id) drives small per-pet
 * stat bumps so the pool isn't perfectly uniform. Kit size penalty: pets
 * with extra jutsus give up some raw stats. Finally appends the elemental
 * special jutsu themed to the pet's assigned element + tier.
 */
export function balanceBuiltInPetTemplate(pet: Pet): Pet {
    const base = balancedPetBaseStats[pet.rarity] ?? balancedPetBaseStats.standard;
    const variant = petVariantIndex(pet);
    const kitBonus = Math.max(0, pet.jutsus.length - 3);
    const hp = base.hp + variant * (pet.rarity === "standard" ? 6 : pet.rarity === "rare" ? 7 : pet.rarity === "legendary" ? 9 : 11) - kitBonus * 18;
    const attack = base.attack + Math.floor(variant * (pet.rarity === "standard" ? 0.7 : pet.rarity === "rare" ? 0.8 : pet.rarity === "legendary" ? 1 : 1.2)) - kitBonus * 2;
    const defense = base.defense + Math.floor(variant * (pet.rarity === "standard" ? 0.55 : pet.rarity === "rare" ? 0.65 : pet.rarity === "legendary" ? 0.85 : 1)) - kitBonus * 2;
    const speed = base.speed + Math.floor(variant * (pet.rarity === "standard" ? 0.5 : pet.rarity === "rare" ? 0.6 : pet.rarity === "legendary" ? 0.75 : 0.9));
    const jutsus = pet.jutsus.map((jutsu, i) => {
        if (jutsu.power <= 0) return { ...jutsu };
        const kindBonus = jutsu.kind === "damage" ? 8 : jutsu.kind === "heal" || jutsu.kind === "barrier" ? 4 : 0;
        const slotBonus = i * 5;
        return { ...jutsu, power: base.jutsuPower + variant + kindBonus + slotBonus };
    });
    // Inject the assigned element from the lookup table. Mythics get their
    // element from the inline template directly (preserved via ...pet) and
    // skip the lookup. Falls back to undefined for any unrecognized name,
    // which the engine treats as neutral.
    const element: JutsuElement | undefined = pet.element ?? petElementByName[pet.name];
    // Append the elemental special jutsu (one per pet, themed to its
    // element + tier-scaled in power and duration). Deduped by name so a
    // template that already declares the special doesn't get a duplicate.
    const specialJutsu = elementalSpecialFor(element, pet.rarity);
    const jutsusWithSpecial = specialJutsu && !jutsus.some(j => j.name === specialJutsu.name)
        ? [...jutsus, specialJutsu]
        : jutsus;
    return capPetStats({ ...pet, hp, attack, defense, speed, jutsus: jutsusWithSpecial, moveRange: pet.moveRange ?? base.moveRange, element });
}

// ── Training math ───────────────────────────────────────────────────────

/** Combined training-speed multiplier: duration tier × Loyal trait × happiness. */
export function petTrainingMultiplier(pet: Pet) {
    const durationMultiplier = petTrainingDurationMultipliers[pet.training?.durationMs ?? petTrainingDurations[0].ms] ?? 1;
    const loyalMultiplier = pet.trait === "Loyal" ? 1.5 : 1;
    const happinessMultiplier = petHappiness(pet) >= 80 ? 1.15 : petHappiness(pet) >= 50 ? 1.05 : 1;
    return durationMultiplier * loyalMultiplier * happinessMultiplier;
}

/** Stat / XP / bond gains from one completed training session. */
export function petTrainingGains(pet: Pet) {
    const mult = petTrainingMultiplier(pet);
    return {
        attack: Math.max(1, Math.round(3 * mult)),
        hp: Math.max(5, Math.round(16 * mult)),
        defense: Math.max(1, Math.round(2 * mult)),
        speed: Math.max(1, Math.round(2 * mult)),
        jutsuPower: Math.max(1, Math.round(2 * mult)),
        xp: Math.max(15, Math.round(45 * mult)),
        bondHp: Math.max(4, Math.round(8 * mult)),
        bondStat: Math.max(1, Math.round(1 * mult)),
    };
}

/** Human-readable preview string for "start training" UI buttons. */
export function petTrainingPreview(pet: Pet, type: PetTrainingType, durationMs: number) {
    const previewPet = { ...pet, training: { type, endsAt: Date.now() + durationMs, durationMs } };
    const gains = petTrainingGains(previewPet);
    if (type === "strength") return `+${gains.attack} ATK, +${gains.xp} XP`;
    if (type === "endurance") return `+${gains.hp} HP, +${gains.defense} DEF, +${gains.xp} XP`;
    if (type === "agility") return `+${gains.speed} SPD, +${gains.xp} XP`;
    if (type === "chakra") return `+${gains.jutsuPower} jutsu power, +${gains.xp} XP`;
    return `+${gains.bondHp} HP, +${gains.bondStat} all battle stats, +${gains.xp + Math.round(gains.xp * 0.35)} XP, +5 happiness`;
}

/** Roll a random trait for a newly-acquired pet. Guardian is mythic-only. */
export function rollPetTrait(rarity: PetRarity): PetTrait {
    const pool = rarity === "mythic" ? petTraits : petTraits.filter((t) => t !== "Guardian");
    return pool[Math.floor(Math.random() * pool.length)];
}

/** Apply a trait's stat bonuses to a pet at spawn time. */
export function applyPetTraitBonuses(pet: Pet, trait: PetTrait): Pet {
    switch (trait) {
        case "Aggressive": return { ...pet, attack: Math.round(pet.attack * 1.15) };
        case "Battleborn": return { ...pet, attack: Math.round(pet.attack * 1.1), hp: Math.round(pet.hp * 1.1), defense: Math.round(pet.defense * 1.1), speed: Math.round(pet.speed * 1.1) };
        case "Guardian": return { ...pet, hp: Math.round(pet.hp * 1.2), defense: Math.round(pet.defense * 1.2) };
        case "Swift": return { ...pet, speed: Math.round(pet.speed * 1.2) };
        default: return pet;
    }
}

/**
 * Apply a completed training session: bumps the trained stat, awards XP
 * (which may trigger level-ups), and resets the active training slot.
 * Bond training also nudges happiness +5 and awards bonus XP.
 */
export function collectPetTraining(pet: Pet): Pet {
    if (!pet.training) return pet;
    const gains = petTrainingGains(pet);
    switch (pet.training.type) {
        case "strength": return capPetStats(gainPetXp({ ...pet, attack: pet.attack + gains.attack, training: undefined }, gains.xp));
        case "endurance": return capPetStats(gainPetXp({ ...pet, hp: pet.hp + gains.hp, defense: pet.defense + gains.defense, training: undefined }, gains.xp));
        case "agility": return capPetStats(gainPetXp({ ...pet, speed: pet.speed + gains.speed, training: undefined }, gains.xp));
        case "chakra": return capPetStats(gainPetXp({ ...pet, jutsus: pet.jutsus.map(j => ({ ...j, power: j.power > 0 ? j.power + gains.jutsuPower : j.power })), training: undefined }, gains.xp));
        case "bond": return capPetStats(gainPetXp(increasePetHappiness({
            ...pet,
            hp: pet.hp + gains.bondHp,
            attack: pet.attack + gains.bondStat,
            defense: pet.defense + gains.bondStat,
            speed: pet.speed + gains.bondStat,
            training: undefined,
        }, 5), gains.xp + Math.round(gains.xp * 0.35)));
    }
}

// ── XP / level-up ───────────────────────────────────────────────────────

export function petXpNeeded(level: number): number {
    return Math.max(100, Math.floor(level * 100));
}

/**
 * Award XP to a pet. Cascade-levels until XP < petXpNeeded(level) or the
 * pet hits its max level. Each level-up bumps base stats (hp+6, atk+1,
 * def+1, every other level +1 speed, +1 power on every damage jutsu).
 * Hitting level 50 flips `unlockedForPve` on so the pet becomes eligible
 * to deploy in PvE encounters.
 */
export function gainPetXp(pet: Pet, amount: number): Pet {
    let level = pet.level;
    let xp = pet.xp + Math.max(0, Math.floor(amount));
    let levelUps = 0;

    while (level < pet.maxLevel && xp >= petXpNeeded(level)) {
        xp -= petXpNeeded(level);
        level += 1;
        levelUps += 1;
    }

    if (level >= pet.maxLevel) {
        level = pet.maxLevel;
        xp = 0;
    }

    const unlockedForPve = Boolean(pet.unlockedForPve || level >= 50);
    if (levelUps <= 0) return { ...pet, level, xp, unlockedForPve };
    return capPetStats({
        ...pet,
        level,
        xp,
        unlockedForPve,
        hp: pet.hp + levelUps * 6,
        attack: pet.attack + levelUps * 1,
        defense: pet.defense + levelUps * 1,
        speed: pet.speed + (levelUps % 2),
        jutsus: pet.jutsus.map((jutsu) => ({ ...jutsu, power: jutsu.power > 0 ? jutsu.power + Math.ceil(levelUps / 2) : jutsu.power })),
    });
}

// ── Misc utilities ──────────────────────────────────────────────────────

/**
 * Clone a pet template for an encounter — fresh id (templateId + timestamp)
 * + a shallow copy of every jutsu so per-encounter cooldown bookkeeping
 * doesn't leak back into the source template.
 */
export function cloneEncounterPet(pet: Pet): Pet {
    return {
        ...pet,
        id: `${pet.id}-${Date.now()}`,
        jutsus: pet.jutsus.map((jutsu) => ({ ...jutsu })),
    };
}

/**
 * Strip the per-encounter timestamp from an encounter-clone id, returning
 * the original template id (matches `standard-N`, `rare-N`, `legendary-N`,
 * or `mythic-N`). Used to look up a saved pet's source template.
 */
export function builtInPetTemplateId(id: string) {
    return id.match(/^(standard|rare|legendary|mythic)-\d+/)?.[0] ?? id;
}

// ── Event boss pet scaling ──────────────────────────────────────────────
// Narrow battle param — avoids dragging CreatorEvent into this module.

type EventPetBattleInput = {
    difficulty?: "easy" | "normal" | "hard" | "impossible";
    bossName?: string;
    backgroundImage?: string;
};

/** Difficulty → stat-multiplier mapping for event pet opponents. */
export function eventPetDifficultyMultiplier(difficulty?: EventPetBattleInput["difficulty"]) {
    if (difficulty === "easy") return 0.75;
    if (difficulty === "hard") return 1.35;
    if (difficulty === "impossible") return 2.1;
    return 1;
}

/**
 * Scale a base pet template into an event-boss-strength opponent. Speed
 * is capped at 1.5× so even "impossible" bosses can't permanently
 * out-tempo the player. Cooldowns are zeroed for a clean encounter start.
 */
export function scaleEventPetOpponent(pet: Pet, battle?: EventPetBattleInput): Pet {
    const mult = eventPetDifficultyMultiplier(battle?.difficulty);
    return capPetStats({
        ...pet,
        id: `event-${pet.id}-${Date.now()}`,
        name: battle?.bossName?.trim() || pet.name,
        image: pet.image || battle?.backgroundImage,
        level: Math.max(1, Math.round(pet.level * mult)),
        hp: Math.round(pet.hp * mult),
        attack: Math.round(pet.attack * mult),
        defense: Math.round(pet.defense * mult),
        speed: Math.round(pet.speed * Math.min(1.5, mult)),
        jutsus: pet.jutsus.map((jutsu) => ({ ...jutsu, power: Math.round(jutsu.power * mult), currentCooldown: 0 })),
    });
}
