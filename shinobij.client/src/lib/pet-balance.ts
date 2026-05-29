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

// ── Signature move (one iconic jutsu per pet) ───────────────────────────
// A second special, distinct from the elemental status jutsu above: each
// pet's *signature* — a strong, element-themed damage-with-effect move the
// AI weaves into its rotation whenever it makes tactical sense (NOT a low-HP
// finisher — it's just part of the kit). It's flagged so the Pet Arena
// narrator/cut-in knows which move is the signature when it lands.
//
// Effect kind is chosen per element so the move is the ONLY jutsu of that kind
// in the pet's kit — that way the AI's single crush/lifesteal branch always
// resolves to the signature (it never gets shadowed by the elemental special,
// whose kinds are burn/freeze/confuse/stun/crush):
//   Fire / Earth → lifesteal (drain — Earth avoids crush, which is its special)
//   Water / Wind / Lightning → crush (shatter + ATK/DEF strip)

export type SignatureKind = "crush" | "lifesteal";

const signatureKindByElement: Record<Exclude<JutsuElement, "None">, SignatureKind> = {
    Fire: "lifesteal",
    Earth: "lifesteal",
    Water: "crush",
    Wind: "crush",
    Lightning: "crush",
};

export type SignatureSpec = { name: string; power: number; cooldown: number };

// Per (tier, element) signature. Generics share an element-themed name within a
// tier (templated, as designed); the five mythics — one per element — get a
// unique flagship name. Power sits at the top of each tier's kit so the move
// feels iconic, but cooldown 4 keeps it a rotational signature, not a nuke.
const signatureByRarityElement: Record<PetRarity, Record<Exclude<JutsuElement, "None">, SignatureSpec>> = {
    standard: {
        Fire:      { name: "Cinder Devour",       power: 90,  cooldown: 4 },
        Water:     { name: "Frost Shatter",       power: 90,  cooldown: 4 },
        Wind:      { name: "Gale Render",         power: 90,  cooldown: 4 },
        Lightning: { name: "Thunderclap Sunder",  power: 90,  cooldown: 4 },
        Earth:     { name: "Gaia's Feast",        power: 90,  cooldown: 4 },
    },
    rare: {
        Fire:      { name: "Ember Communion",     power: 112, cooldown: 4 },
        Water:     { name: "Glacier Breaker",     power: 112, cooldown: 4 },
        Wind:      { name: "Cyclone Render",      power: 112, cooldown: 4 },
        Lightning: { name: "Voltaic Sunder",      power: 112, cooldown: 4 },
        Earth:     { name: "Verdant Feast",       power: 112, cooldown: 4 },
    },
    legendary: {
        Fire:      { name: "Inferno Communion",   power: 132, cooldown: 4 },
        Water:     { name: "Absolute Zero",       power: 132, cooldown: 4 },
        Wind:      { name: "Tempest Sundering",   power: 132, cooldown: 4 },
        Lightning: { name: "Heaven's Sundering",  power: 132, cooldown: 4 },
        Earth:     { name: "World Tree Feast",    power: 132, cooldown: 4 },
    },
    mythic: {
        Fire:      { name: "Supernova: Solar Communion",       power: 152, cooldown: 4 }, // Solar Stag
        Water:     { name: "Absolute Zero: Glacial Apocalypse", power: 152, cooldown: 4 }, // Ancient Frost Titan
        Wind:      { name: "Lunar Eclipse: Ninetail Requiem",  power: 152, cooldown: 4 }, // Eclipse Kitsune
        Lightning: { name: "Worldstorm: Heaven's End",         power: 152, cooldown: 4 }, // Worldstorm Dragon
        Earth:     { name: "Hellgate: Soul Devour",            power: 152, cooldown: 4 }, // Abyssal Oni Hound
    },
};

// Per-NAME override for the expansion mythics. Each mythic tier holds one pet
// per element, but the pool now has two mythics per element (original +
// expansion) — the element-keyed table above can only name one, so the second
// of each element looks itself up here by name to keep its OWN flagship
// signature. (The five originals fall through to the element table.)
const mythicSignatureByName: Record<string, SignatureSpec> = {
    "Vermillion Suzaku":  { name: "Vermillion Rebirth: Phoenix Pyre",    power: 152, cooldown: 4 },
    "Azure Ryujin":       { name: "Dragon God's Maelstrom",              power: 152, cooldown: 4 },
    "Celestial Tengu":    { name: "Heavenfall: Crow Tempest",            power: 152, cooldown: 4 },
    "Stormgod Raijin":    { name: "Raijin's Wrath: Thunder Apocalypse",  power: 152, cooldown: 4 },
    "Worldroot Colossus": { name: "World Devourer: Gaia's Embrace",      power: 152, cooldown: 4 },
};

/** Pull the signature jutsu spec for a pet. A per-name mythic override wins
 *  (so each flagship keeps a unique signature even when two mythics share an
 *  element); otherwise it's the element+tier entry. Flagged so the arena cut-in
 *  recognizes it. Null for elementless pets (they fall back to the auto-derived
 *  strongest move in petSignatureJutsu). */
export function signatureMoveFor(element: JutsuElement | undefined, rarity: PetRarity, name?: string): PetJutsu | null {
    if (!element || element === "None") return null;
    const override = name ? mythicSignatureByName[name] : undefined;
    const tierTable = signatureByRarityElement[rarity] ?? signatureByRarityElement.standard;
    const spec = override ?? tierTable[element as Exclude<JutsuElement, "None">];
    if (!spec) return null;
    return {
        name: spec.name,
        power: spec.power,
        cooldown: spec.cooldown,
        currentCooldown: 0,
        kind: signatureKindByElement[element as Exclude<JutsuElement, "None">],
        signature: true,
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
    // Wrap the id-derived variant within the per-tier template count. The pool
    // ships in two batches (original + expansion) whose ids keep counting up
    // (standard-25…, etc.); without this wrap a higher id would scale stats
    // ever higher. Modulo makes the second batch reuse the SAME 0..N-1 spread
    // as the first, so an expansion pet is balanced identically to its
    // same-slot original. Existing pets (id < count) are unaffected.
    const tierCount = pet.rarity === "standard" || pet.rarity === "rare" ? 25 : pet.rarity === "legendary" ? 15 : 5;
    const variant = petVariantIndex(pet) % tierCount;
    // +1 accounts for the signature jutsu appended below (every elemental pet
    // gets one). It's a real kit slot, so it pays the same per-extra-jutsu stat
    // tax as anything beyond the third — keeping the new move balanced exactly
    // like the rest of the kit. The elemental special is appended the same way
    // but predates this and is folded into the base stat table already.
    const kitBonus = Math.max(0, pet.jutsus.length - 3) + 1;
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
    // Append the signature jutsu LAST — after the elemental special — so the
    // slot-based save-merge in normalizePet backfills it into a fresh trailing
    // slot for existing pets (it won't collide with / overwrite a slot they
    // already hold). Deduped by name so re-balancing is idempotent.
    const signatureJutsu = signatureMoveFor(element, pet.rarity, pet.name);
    const jutsusFinal = signatureJutsu && !jutsusWithSpecial.some(j => j.name === signatureJutsu.name)
        ? [...jutsusWithSpecial, signatureJutsu]
        : jutsusWithSpecial;
    return capPetStats({ ...pet, hp, attack, defense, speed, jutsus: jutsusFinal, moveRange: pet.moveRange ?? base.moveRange, element });
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
