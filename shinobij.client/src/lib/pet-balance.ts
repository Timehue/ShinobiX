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
    petRarityOrder,
} from "../data/pet-config";
import { petElementByName } from "../data/pet-elements";
import { petHappiness, increasePetHappiness, petVariantIndex } from "./pet";
import { derivePetRole, roleStatMult, petTemplateArchetype, type PetSubRole } from "./pet-roles";

// ── Per-rarity stat clamp ───────────────────────────────────────────────

/**
 * Clamp every numeric pet stat to its per-rarity ceiling. Jutsu power
 * is similarly clamped per-rarity (0-power slots are left alone so
 * utility jutsus stay utility). moveRange is bounded to [2, 5].
 */
export function capPetStats(pet: Pet): Pet {
    const caps = petStatCaps[pet.rarity] ?? petStatCaps.standard;
    // Backfill the native role/sub-role if absent (old saves load through here via
    // normalizePet) — deterministic, so this never changes an already-set role.
    const { role, subRole } = pet.role && pet.subRole ? pet : derivePetRole(pet);
    return {
        ...pet,
        role, subRole,
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

// Per-NAME flagship signature overrides. Two uses:
//  1) Expansion mythics — the element-keyed table above names only one mythic
//     per element, but the pool has two (original + expansion); the second of
//     each element looks itself up here to keep its OWN flagship signature.
//  2) APEX LEGENDARIES — a curated 1-per-element set kept iconic + strong:
//     each gets a UNIQUE flagship signature name at power 142 (above a normal
//     legendary's 132, below a mythic's 152), so "some legendaries" stay
//     distinctive instead of sharing the element-tier signature name. They keep
//     their archetype kit + element special; only the signature is bespoke.
const flagshipSignatureByName: Record<string, SignatureSpec> = {
    // Mythic expansion flagships (one per element).
    "Vermillion Suzaku":  { name: "Vermillion Rebirth: Phoenix Pyre",    power: 152, cooldown: 4 },
    "Azure Ryujin":       { name: "Dragon God's Maelstrom",              power: 152, cooldown: 4 },
    "Turtle Duck":        { name: "Heavenfall: Crow Tempest",            power: 152, cooldown: 4 },
    "Stormgod Raijin":    { name: "Raijin's Wrath: Thunder Apocalypse",  power: 152, cooldown: 4 },
    "Worldroot Colossus": { name: "World Devourer: Gaia's Embrace",      power: 152, cooldown: 4 },
    // Apex legendaries (one iconic boss per element) — unique + stronger signature.
    "Inferno Chimera":    { name: "Triple Maw: Infernal Devour",         power: 142, cooldown: 4 },
    "Tidelord Leviathan": { name: "Abyssal Tide: Leviathan's Maw",       power: 142, cooldown: 4 },
    "Storm Roc":          { name: "Skytalon: Tempest Dive",              power: 142, cooldown: 4 },
    "Thunder Raiju":      { name: "Raiju's Fury: Thunderclap Rush",      power: 142, cooldown: 4 },
    "Titan Golem":        { name: "Titanfall: Seismic Ruin",             power: 142, cooldown: 4 },
};

/** Pull the signature jutsu spec for a pet. A per-name flagship override wins
 *  (so each expansion mythic + apex legendary keeps a UNIQUE signature even when
 *  it shares an element with others); otherwise it's the element+tier entry.
 *  Flagged so the arena cut-in recognizes it. Null for elementless pets (they
 *  fall back to the auto-derived strongest move in petSignatureJutsu). */
export function signatureMoveFor(element: JutsuElement | undefined, rarity: PetRarity, name?: string): PetJutsu | null {
    if (!element || element === "None") return null;
    const override = name ? flagshipSignatureByName[name] : undefined;
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

// ── Phase 12b: per-archetype kit identity ────────────────────────────────
// Re-theme each non-mythic template's UTILITY slots to a combat archetype, so
// a pet's kit reflects a ROLE (tank/bruiser/striker/kite/control/support/
// assassin) instead of a generic Guard/Bind/Mend rotation. The archetype is
// derived deterministically from element + variant, so every tier spans the
// full role spread and an element keeps a consistent fantasy (Fire = aggressive,
// Water = defensive/sustain, Earth = sturdy, Wind = evasive/tricky, Lightning =
// fast burst).
//
// Rarity gates how many *new-mechanic* slots (wound/mark/slow/haste/taunt/push/
// pull — the Phase-12 kinds) a pet may hold:
//   standard  0  — basic kinds only (simple + readable)
//   rare      1  — one signature mechanic
//   legendary 2  — two role mechanics / a combo
//   mythic    —  the hand-crafted kit is preserved; one signature mechanic is
//                APPENDED (see mythicSignatureMechanic), themed to its identity.
//
// SAVE-SAFETY: this only edits TEMPLATES. normalizePet merges jutsus
// positionally with the player's slot winning kind/name, so existing pets are
// grandfathered (they migrate in a later step) — and the DAMAGE + MOVE slots,
// slot COUNT, and slot ORDER are never changed, so the positional merge stays
// aligned. No pet has every answer: each archetype trades away whole categories
// (a tank has no burst mechanic, an assassin no heal/shield, support no control).

// The archetype (= sub-role) taxonomy + the (element, variant) → archetype lookup
// now live in ./pet-roles (the native-role source of truth). Re-exported here so
// existing importers + the kit-themer tests keep resolving from "./pet-balance".
export type PetTemplateArchetype = PetSubRole;
export { petTemplateArchetype };

type KitSpec = { kind: PetJutsu["kind"]; label: string };

// Each archetype's utility palette. `mechanics` are the Phase-12 role mechanics,
// richest first (gated by the rarity budget). `basics` are the simple-kind
// fallbacks that fill the rest of the utility slots (and the lone utility slot
// of a standard, which gets NO new mechanic). The combination defines the
// archetype's identity AND its weaknesses (what it deliberately lacks).
const ARCHETYPE_KIT: Record<PetTemplateArchetype, { mechanics: KitSpec[]; basics: KitSpec[] }> = {
    tank:     { mechanics: [{ kind: "taunt", label: "Challenging Roar" }, { kind: "shield", label: "Bulwark" }], basics: [{ kind: "barrier", label: "Guard" }] },
    // Bruiser is melee and wants to STICK to its target → pull yanks a fleeing /
    // kiting foe back into mauling range (anti-kite). Paired with the wound bleed.
    bruiser:  { mechanics: [{ kind: "wound", label: "Rending Maul" }, { kind: "pull", label: "Grappling Hook" }], basics: [{ kind: "barrier", label: "Iron Brace" }] },
    striker:  { mechanics: [{ kind: "mark", label: "Opening Strike" }, { kind: "haste", label: "Battle Tempo" }], basics: [{ kind: "debuff", label: "Weaken" }] },
    kite:     { mechanics: [{ kind: "slow", label: "Hobbling Shot" }, { kind: "haste", label: "Quickstep" }],     basics: [{ kind: "debuff", label: "Sand Veil" }] },
    // Control is ranged and wants SPACING → push shoves a crowding foe away so it
    // can keep kiting + stacking slows (peel / zone control). Paired with slow.
    control:  { mechanics: [{ kind: "slow", label: "Frost Shackle" }, { kind: "push", label: "Force Pulse" }],    basics: [{ kind: "movelock", label: "Bind" }] },
    support:  { mechanics: [{ kind: "haste", label: "Inspire" }],                                                 basics: [{ kind: "heal", label: "Mend" }, { kind: "shield", label: "Aegis" }] },
    assassin: { mechanics: [{ kind: "mark", label: "Death Mark" }, { kind: "wound", label: "Lacerate" }],         basics: [{ kind: "debuff", label: "Expose" }] },
};

// How many NEW-mechanic slots each tier may host (a CAP, not a quota — support
// only carries one mechanic even at legendary, so it stays sustain-focused).
const NEW_MECH_BUDGET: Record<PetRarity, number> = { standard: 0, rare: 1, legendary: 2, mythic: 0 };

// Kinds whose magnitude is driven by `power` (so the template seed must stay
// > 0 to get scaled). The pure-status Phase-12 kinds (mark/slow/haste/taunt)
// and movelock ignore power entirely → seeded at 0 so the scaler leaves them.
const POWER_BEARING_KINDS = new Set<PetJutsu["kind"]>([
    "damage", "heal", "barrier", "shield", "dot", "wound", "push", "pull", "lifesteal", "crush", "absorb", "debuff", "buff",
]);

/** Ordered list of utility specs to drop into a template's utility slots:
 *  the first `budget` role mechanics (those that exist) followed by the basics,
 *  generously padded so any number of utility slots can be filled. */
function archetypeUtilityFill(archetype: PetTemplateArchetype, rarity: PetRarity): KitSpec[] {
    const kit = ARCHETYPE_KIT[archetype];
    const budget = NEW_MECH_BUDGET[rarity] ?? 0;
    const mechanics = kit.mechanics.slice(0, budget);
    return [...mechanics, ...kit.basics, ...kit.basics, ...kit.basics];
}

/** Re-theme a template's UTILITY slots (everything that isn't the primary
 *  `damage` hit or the `move` dash) to the pet's archetype, preserving slot
 *  count + order. Damage and move slots are returned untouched. */
export function applyArchetypeKit(jutsus: PetJutsu[], archetype: PetTemplateArchetype, rarity: PetRarity, petName: string): PetJutsu[] {
    const fill = archetypeUtilityFill(archetype, rarity);
    let ordinal = 0;
    return jutsus.map((jutsu) => {
        if (jutsu.kind === "damage" || jutsu.kind === "move") return jutsu;
        const spec = fill[ordinal++] ?? fill[fill.length - 1];
        return {
            ...jutsu,
            name: `${petName} ${spec.label}`,
            kind: spec.kind,
            // Power-bearing kinds keep a positive seed so the scaler in
            // balanceBuiltInPetTemplate replaces it with a tier-scaled value;
            // pure-status kinds are pinned to 0 (their handlers ignore power).
            power: POWER_BEARING_KINDS.has(spec.kind) ? Math.max(1, jutsu.power || 1) : 0,
        };
    });
}

// ── Mythic signature mechanic (one Phase-12 kind appended per mythic) ─────────
// Mythics keep their hand-crafted kits; each gains ONE signature mechanic that
// leans into its stated identity. Appended LAST (after the elemental special +
// signature) so the positional save-merge backfills it into a fresh trailing
// slot — purely additive, exactly like the elemental-special rollout, never a
// nerf. Power: utility-status kinds at 0; the lone wound (Oni Hound) carries a
// real bleed value (clamped by capPetStats to the mythic jutsu-power ceiling).
type MythicMechSpec = { kind: PetJutsu["kind"]; name: string; cooldown: number; power: number; rounds?: number };

const mythicMechByName: Record<string, MythicMechSpec> = {
    "Eclipse Kitsune":     { kind: "haste", name: "Eclipse Veil",        cooldown: 4, power: 0,   rounds: 2 }, // moon-sage evasive ward
    "Worldstorm Dragon":   { kind: "haste", name: "Storm Tempo",         cooldown: 4, power: 0,   rounds: 2 }, // storm striker
    "Ancient Frost Titan": { kind: "taunt", name: "Glacial Challenge",   cooldown: 4, power: 0,   rounds: 2 }, // fortress tank
    "Solar Stag":          { kind: "mark",  name: "Solar Brand",         cooldown: 4, power: 0,   rounds: 2 }, // debuffer striker
    "Abyssal Oni Hound":   { kind: "wound", name: "Abyssal Rend",        cooldown: 5, power: 120, rounds: 3 }, // glass-cannon brawler
    "Vermillion Suzaku":   { kind: "mark",  name: "Phoenix Brand",       cooldown: 4, power: 0,   rounds: 2 }, // reborn bruiser
    "Azure Ryujin":        { kind: "taunt", name: "Dragon's Challenge",  cooldown: 4, power: 0,   rounds: 2 }, // bulky control bruiser
    "Turtle Duck":         { kind: "mark",  name: "Tengu Mark",          cooldown: 4, power: 0,   rounds: 3 }, // trickster assassin
    "Stormgod Raijin":     { kind: "haste", name: "Raijin Tempo",        cooldown: 4, power: 0,   rounds: 2 }, // burst striker
    "Worldroot Colossus":  { kind: "taunt", name: "Worldroot Challenge", cooldown: 4, power: 0,   rounds: 2 }, // immovable tank
};

/** The signature Phase-12 mechanic appended to a mythic, or null for a name
 *  with no entry (keeps the function total over the mythic pool). */
export function mythicSignatureMechanic(name: string): PetJutsu | null {
    const spec = mythicMechByName[name];
    if (!spec) return null;
    return {
        name: spec.name,
        power: spec.power,
        cooldown: spec.cooldown,
        currentCooldown: 0,
        kind: spec.kind,
        ...(spec.rounds ? { rounds: spec.rounds } : {}),
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
    // Inject the assigned element from the lookup table. Mythics get their
    // element from the inline template directly (preserved via ...pet) and
    // skip the lookup. Falls back to undefined for any unrecognized name,
    // which the engine treats as neutral. (Resolved before the archetype
    // re-theme below, which keys off the element.)
    const element: JutsuElement | undefined = pet.element ?? petElementByName[pet.name];
    // Native role + sub-role (starter/mythic overrides + the even %4 cycle). The
    // sub-role themes the kit; the role+sub-role lean the base stats below.
    const { role, subRole } = derivePetRole({ id: pet.id, name: pet.name, element, rarity: pet.rarity });
    // Phase 12b: re-theme the non-mythic utility slots to the pet's SUB-ROLE
    // (damage + move slots, and the slot count/order, are preserved so the
    // positional save-merge keeps grandfathering existing pets). Sages always
    // theme as `support` so every sage carries an ally heal (owner requirement).
    // Mythics keep their hand-crafted kit untouched (their signature mechanic is
    // appended further below). kitBonus is unchanged — same slot count.
    const kitArchetype: PetSubRole = role === "sage" ? "support" : subRole;
    const baseKit = pet.rarity === "mythic"
        ? pet.jutsus
        : applyArchetypeKit(pet.jutsus, kitArchetype, pet.rarity, pet.name);
    const jutsus = baseKit.map((jutsu, i) => {
        if (jutsu.power <= 0) return { ...jutsu };
        const kindBonus = jutsu.kind === "damage" ? 8 : jutsu.kind === "heal" || jutsu.kind === "barrier" ? 4 : 0;
        const slotBonus = i * 5;
        return { ...jutsu, power: base.jutsuPower + variant + kindBonus + slotBonus };
    });
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
    // Phase 12b: append the mythic's signature archetype mechanic LAST (after
    // the elemental special + signature) so it backfills into a fresh trailing
    // slot for existing mythic owners — purely additive, no stat change (it's
    // added after the kitBonus stat math). Deduped by name → idempotent.
    const mythicMech = pet.rarity === "mythic" ? mythicSignatureMechanic(pet.name) : null;
    const jutsusComplete = mythicMech && !jutsusFinal.some(j => j.name === mythicMech.name)
        ? [...jutsusFinal, mythicMech]
        : jutsusFinal;
    // Lean the BASE stats toward the role + sub-role (budget-neutral-ish, clamped
    // by capPetStats) — applied to ALL tiers including mythics, since the inline
    // mythic stats are recomputed from the base table anyway, so without the lean a
    // "fortress tank" mythic would be no tankier than a "glass-cannon" one. Their
    // role is chosen to fit their hand-crafted kit (MYTHIC_ROLE), so kit + stats now
    // agree. Training customizes freely on top of this baseline.
    const tilt = roleStatMult(role, subRole);
    return capPetStats({
        ...pet, role, subRole,
        hp: hp * tilt.hp, attack: attack * tilt.attack, defense: defense * tilt.defense, speed: speed * tilt.speed,
        jutsus: jutsusComplete, moveRange: pet.moveRange ?? base.moveRange, element,
    });
}

// ── Phase 12c: migrate a saved pet's kit onto its (redesigned) template ───────

/**
 * Merge a saved pet's jutsu slots onto its current built-in template. The
 * template's EFFECT wins (kind / name / cooldown / rounds / signature / aoe) so
 * an existing pet ADOPTS the redesigned archetype kit (Phase 12b), while the
 * player's leveled POWER is preserved (power = max of the two). New trailing
 * template slots backfill; any extra player-only slot is kept; currentCooldown
 * resets to 0.
 *
 * This is the one-way Phase-12 migration — it replaces the legacy generic
 * utility kinds (the Guard/Bind/Mend rotation) with each pet's archetype
 * identity. Because the DAMAGE, MOVE, elemental-special and signature slots are
 * IDENTICAL between the old and new templates, the only slots whose effect
 * actually changes are the re-themed utility slots. Everything that represents
 * player investment lives on the pet, not the jutsu slots:
 *   - stats (hp/attack/defense/speed), level, xp, loadout, trait, happiness →
 *     untouched here (normalizePet preserves them, stats via Math.max).
 *   - jutsu POWER (from level-ups + chakra training) → preserved via Math.max.
 *
 * Pure + deterministic; idempotent (re-running on an already-migrated pet is a
 * no-op since the kinds already match the template).
 */
export function mergePetJutsuSlots(playerJutsus: PetJutsu[], templateJutsus: PetJutsu[]): PetJutsu[] {
    const maxLen = Math.max(playerJutsus.length, templateJutsus.length);
    return Array.from({ length: maxLen }, (_, i) => {
        const base = templateJutsus[i];
        const player = playerJutsus[i];
        if (!player && base) return { ...base, currentCooldown: 0 };       // template gained a slot
        if (!base && player) return { ...player, currentCooldown: 0 };     // player holds an extra slot
        return {
            ...player,
            ...base,                                                       // adopt the template's effect
            power: Math.max(player.power ?? 0, base.power ?? 0),           // keep the leveled power
            currentCooldown: 0,
        };
    });
}

/**
 * Apply an admin-AUTHORED template kit — used when the template comes from the
 * admin Pet Editor (a published, intentional kit) rather than the hardcoded
 * baseline. The admin panel is AUTHORITATIVE: the result IS the template kit
 * exactly — same length, and each slot's name/kind/cooldown/rounds/signature/aoe
 * AND power are taken straight from the template. So an admin REMOVING a move
 * drops it, ADDING one backfills a trailing slot, and editing a move's power
 * applies verbatim — even a DECREASE overrides any level-up / chakra-training
 * power the player had banked on that slot (owner-chosen WYSIWYG behavior; cf.
 * mergePetJutsuSlots, the baseline migration path, which keeps the leveled power
 * via Math.max). currentCooldown resets to 0.
 *
 * Pure + deterministic; idempotent (re-running on an already-authored kit is a
 * no-op since the slots already match the template).
 */
export function applyAuthoredPetJutsus(templateJutsus: PetJutsu[]): PetJutsu[] {
    return templateJutsus.map((base) => ({ ...base, currentCooldown: 0 }));
}

// ── Admin-published (authored) pet templates ──────────────────────────────────
// Pets edited in the admin Pet Editor ship in the admin save (editablePets) and
// every client pulls those saves (App.pullSharedAdminContent). Edited pets carry
// an `updatedAt` stamp; we register them here, keyed by base template id, so
// resolvePetTemplateJutsus adopts the admin-AUTHORED kit/stats for every player's
// instance — overriding the hardcoded balanced baseline. Unedited pets (no
// updatedAt) are ignored, so they keep the built-in template exactly. This is the
// one intentional module-level registry in an otherwise-pure file; it's populated
// only by the admin-content pull and read by normalizePet.
const publishedPetTemplates = new Map<string, Pet>();

/**
 * Merge a pulled admin save's editablePets into the registry. Only admin-edited
 * pets (updatedAt present) override; when the same pet is edited in BOTH admin
 * saves, the STRICTLY-newer copy wins (recency — avoids a stale snapshot
 * clobbering a fresh edit). Returns true if anything changed so the caller can
 * re-normalize the live roster.
 */
export function registerPublishedPetTemplates(pets: Pet[]): boolean {
    let changed = false;
    for (const pet of pets) {
        if (!pet?.updatedAt) continue;
        const baseId = builtInPetTemplateId(pet.id);
        const existing = publishedPetTemplates.get(baseId);
        if (existing && (existing.updatedAt ?? 0) >= (pet.updatedAt ?? 0)) continue;
        publishedPetTemplates.set(baseId, pet);
        changed = true;
    }
    return changed;
}

/**
 * Resolve a saved pet's effective base template + merged jutsus. An admin-
 * published (authored) template wins over the hardcoded baseline (`fallback`);
 * its kit is applied EXACTLY — the admin panel is authoritative, including power
 * (applyAuthoredPetJutsus). Otherwise the baseline's Phase-12c slot merge runs
 * (mergePetJutsuSlots — template effect wins, player extra slots kept, leveled
 * power preserved via Math.max). Returns the baseline pet's `jutsus` untouched
 * when no template exists.
 */
export function resolvePetTemplateJutsus(pet: Pet, fallback: Pet | undefined): { template: Pet | undefined; jutsus: PetJutsu[] } {
    const authored = publishedPetTemplates.get(builtInPetTemplateId(pet.id));
    const template = authored ?? fallback;
    if (!template) return { template: undefined, jutsus: pet.jutsus ?? [] };
    const jutsus = authored
        ? applyAuthoredPetJutsus(template.jutsus)
        : mergePetJutsuSlots(pet.jutsus ?? [], template.jutsus);
    return { template, jutsus };
}

/**
 * Normalize a saved/loaded pet against the built-in pool: adopt its effective
 * template (admin-authored kit wins, else the hardcoded baseline), floor its
 * stats vs the template, and clamp everything to the rarity caps. `petPool` is the
 * caller's full built-in pool (App-local — it closes over the balanced rawPetPool
 * plus the starters/evolutions). Reads the published-template registry; otherwise
 * pure. (Lived inline in App.tsx; extracted here as the canonical pet-normalizer.)
 */
export function normalizePetTemplate(pet: Pet, petPool: Pet[]): Pet {
    const fallback = petPool.find((template) => template.id === builtInPetTemplateId(pet.id));
    const { template: baseTemplate, jutsus } = resolvePetTemplateJutsus(pet, fallback);
    const merged = baseTemplate ? {
        ...pet,
        hp: Math.max(pet.hp ?? 0, baseTemplate.hp),
        attack: Math.max(pet.attack ?? 0, baseTemplate.attack),
        defense: Math.max(pet.defense ?? 0, baseTemplate.defense),
        speed: Math.max(pet.speed ?? 0, baseTemplate.speed),
        moveRange: pet.moveRange ?? baseTemplate.moveRange,
        // Backfill element for pre-element saves; the pet's own element wins if set.
        element: pet.element ?? baseTemplate.element,
        jutsus,
    } : pet;
    return capPetStats({
        ...merged,
        rarity: merged.rarity ?? "standard",
        level: Math.max(1, Math.floor(merged.level ?? 1)),
        xp: Math.max(0, Math.floor(merged.xp ?? 0)),
        maxLevel: Math.max(1, Math.floor(merged.maxLevel ?? 100)),
        unlockedForPve: Boolean(merged.unlockedForPve || Math.floor(merged.level ?? 1) >= 50),
        happiness: petHappiness(merged),
        expedition: merged.expedition
            ? { type: merged.expedition.type ?? "scout", startedAt: Number(merged.expedition.startedAt ?? Date.now()), endsAt: Number(merged.expedition.endsAt), durationMs: Number(merged.expedition.durationMs ?? 60 * 60 * 1000), token: typeof merged.expedition.token === "string" ? merged.expedition.token : undefined }
            : undefined,
    });
}

/**
 * Re-normalize a roster (owned pets) with `normalize`, returning the new array
 * only when a pet's effective kit/stats actually changed (else null, so callers
 * skip a needless state update). Used to push live admin pet-editor edits onto
 * the editing admin's own pets in-session. Pure.
 */
export function renormalizedIfChanged(roster: Pet[], normalize: (pet: Pet) => Pet): Pet[] | null {
    const pets = roster.map(normalize);
    const sig = (p: Pet) => JSON.stringify([p.jutsus, p.hp, p.attack, p.defense, p.speed, p.role, p.subRole, p.moveRange]);
    return pets.some((p, i) => sig(p) !== sig(roster[i])) ? pets : null;
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
export function collectPetTraining(pet: Pet, xpMult: number = 1): Pet {
    if (!pet.training) return pet;
    const gains = petTrainingGains(pet);
    // xpMult < 1 applies the village "demoralized" war-loss debuff (-10% pet
    // training XP). Default 1 keeps every other caller unchanged.
    const xp = Math.max(0, Math.round(gains.xp * xpMult));
    const bondXp = Math.max(0, Math.round((gains.xp + Math.round(gains.xp * 0.35)) * xpMult));
    switch (pet.training.type) {
        case "strength": return capPetStats(gainPetXp({ ...pet, attack: pet.attack + gains.attack, training: undefined }, xp));
        case "endurance": return capPetStats(gainPetXp({ ...pet, hp: pet.hp + gains.hp, defense: pet.defense + gains.defense, training: undefined }, xp));
        case "agility": return capPetStats(gainPetXp({ ...pet, speed: pet.speed + gains.speed, training: undefined }, xp));
        case "chakra": return capPetStats(gainPetXp({ ...pet, jutsus: pet.jutsus.map(j => ({ ...j, power: j.power > 0 ? j.power + gains.jutsuPower : j.power })), training: undefined }, xp));
        case "bond": return capPetStats(gainPetXp(increasePetHappiness({
            ...pet,
            hp: pet.hp + gains.bondHp,
            attack: pet.attack + gains.bondStat,
            defense: pet.defense + gains.bondStat,
            speed: pet.speed + gains.bondStat,
            training: undefined,
        }, 5), bondXp));
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

/**
 * Whether a pet may appear as a random wild befriend in explore-tile
 * encounters. Two independent guards (belt-and-suspenders):
 *   1. An explicit `wildSpawnable: false` flag (set on the starter base forms
 *      AND their evolved templates), and
 *   2. The `starter-` id prefix convention (covers `starter-fire`,
 *      `starter-fire-r`, `starter-fire-l`, …) so even an un-flagged starter
 *      template stays out of the wild.
 * Both the starters and their evolutions live in the pool ONLY so the admin
 * Pet Editor can image them — they must never spawn for players.
 * See docs/pet-starter-evolution-plan.md §3.6.
 */
export function isWildSpawnable(pet: Pet): boolean {
    return pet.wildSpawnable !== false && !pet.id.startsWith("starter-");
}

export function rollPetEncounter(pets: Pet[]): Pet | null {
    const roll = Math.random();

    // Total pet chance: 1% — 1 in 100 explores
    // Mythic: 0.02%
    // Legendary: 0.18%
    // Rare: 0.30%
    // Standard: 0.50%

    function choosePetFromRarity(rarity: PetRarity): Pet | null {
        const rarityIndex = petRarityOrder.indexOf(rarity);
        const fallbackRarities = petRarityOrder.slice(0, rarityIndex + 1).reverse();
        for (const fallbackRarity of fallbackRarities) {
            // Exclude the choose-at-creation starter companions AND their
            // evolved templates — they live in petPool only so the admin Pet
            // Editor can image them; they must never appear as a random wild
            // befriend. See isWildSpawnable.
            const pool = pets.filter((pet) => pet.rarity === fallbackRarity && isWildSpawnable(pet));
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            if (chosen) return cloneEncounterPet(chosen);
        }
        return null;
    }

    if (roll <= 0.002) {
        return choosePetFromRarity("mythic");
    }

    if (roll <= 0.007) {
        return choosePetFromRarity("legendary");
    }

    if (roll <= 0.01) {
        return choosePetFromRarity("rare");
    }

    if (roll <= 0.05) {
        return choosePetFromRarity("standard");
    }

    return null;
}
