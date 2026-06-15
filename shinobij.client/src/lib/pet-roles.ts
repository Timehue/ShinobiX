/*
 * Native pet ROLES — the intrinsic combat identity carried by every pet.
 *
 * Two-tier taxonomy (see docs/pet-native-roles-plan.md):
 *   • ROLE (4)      — the coarse identity the combat AI + tactical arena read:
 *                     defender / tracker / assassin / sage.
 *   • SUB-ROLE (7)  — the finer archetype that nests UNDER a role and flavors
 *                     stats + moveset: tank/bruiser (defender), assassin/striker
 *                     (assassin), kite/control (tracker), support/control (sage).
 *
 * Role → base stat lean + engagement range + moveset theme; the player's
 * TRAINING then freely customizes on top (role sets the baseline only).
 *
 * Distribution goals (owner):
 *   • The 5 starters cover all 4 roles (one role doubles — Assassin).
 *   • Roles are ~evenly distributed (~25% each) across the whole 140-pet pool.
 *     Achieved by cycling the 4 roles by the id-variant % 4, which stays even
 *     per rarity tier regardless of how the element batches are sized.
 *
 * Pure + deterministic (NO rng / Date): role is a stable function of the pet's
 * id-variant + element (+ explicit starter/mythic overrides), so ranked replays
 * stay byte-identical and both clients of a match agree.
 */

import type { JutsuElement } from "../types/core";
import type { Pet } from "../types/pet";

export type PetRole = "defender" | "tracker" | "assassin" | "sage";

// The 7 archetypes (sub-roles). Identical names to the legacy PetTemplateArchetype
// (re-exported from pet-balance for back-compat) and to pet-tactics' PetArchetype,
// so a sub-role drops straight into the existing moveset themer + grid-battle AI.
export type PetSubRole = "tank" | "bruiser" | "striker" | "assassin" | "kite" | "control" | "support";

// Display metadata for the role badge (label + icon + accent color). Colors echo
// the kit-chip palette: defender blue, tracker amber, assassin red, sage green.
export const ROLE_META: Record<PetRole, { label: string; icon: string; color: string }> = {
    defender: { label: "Defender", icon: "🛡", color: "#7dd3fc" },
    tracker: { label: "Tracker", icon: "🎯", color: "#fbbf24" },
    assassin: { label: "Assassin", icon: "🗡", color: "#fca5a5" },
    sage: { label: "Sage", icon: "✚", color: "#4ade80" },
};

// Which role each sub-role belongs to. `control` is the swing sub-role — it
// defaults to TRACKER (offensive zoner) but is re-homed to SAGE for Water pets
// (defensive sustain) inside derivePetRole; this map is the default used by
// callers that only have a sub-role in hand (e.g. the grid-battle AI).
export const ROLE_OF_SUBROLE: Record<PetSubRole, PetRole> = {
    tank: "defender", bruiser: "defender",
    assassin: "assassin", striker: "assassin",
    kite: "tracker", control: "tracker",
    support: "sage",
};

// The two sub-roles that compose each role (primary, alt). The arena/grid pick a
// variant for in-role variety; element theme decides which is primary.
const SUBROLES_OF_ROLE: Record<PetRole, [PetSubRole, PetSubRole]> = {
    defender: ["tank", "bruiser"],
    tracker: ["kite", "control"],
    assassin: ["assassin", "striker"],
    sage: ["support", "control"],
};

// ── Engagement range (calculated + used DURING fights) ────────────────────────
// Single source of truth for how far a role fights from its target. The tactical
// arena reads atkRange/neutral every tick (a sage holds at 4.6, a defender closes
// to 1.5); the grid sim derives its per-turn move range from melee/ranged. Values
// match the arena's historical ROLE_CFG so this is a refactor, not a balance shift.
export interface RoleRange { atkRange: number; neutral: number; melee: boolean; }
export const ROLE_RANGE: Record<PetRole, RoleRange> = {
    defender: { atkRange: 1.5, neutral: 1.5, melee: true },
    assassin: { atkRange: 1.6, neutral: 2.2, melee: true },
    tracker: { atkRange: 4.0, neutral: 3.4, melee: false },
    sage: { atkRange: 4.6, neutral: 5.5, melee: false },
};

// ── Stat lean (budget-neutral-ish role tilt + small sub-role tilt) ────────────
// Multipliers applied to the rarity base stats so a pet's BASE stats express its
// role. Kept modest (±~20%) and clamped by capPetStats; redistributive, not
// inflationary, so no tier/role dominates. Training then customizes on top.
// Owner: bruiser gains HP *and* ATK (not just ATK), trading DEF.
export interface StatMult { hp: number; attack: number; defense: number; speed: number; }
// Tuned against scripts/pet-role-balance.ts (live 1v1 engine). The round engine
// rewards raw attack, so a first draft had assassin ~70% / tracker ~25%. Tracker is
// INTENDED to be stronger in the tactical arena (range/positioning) than 1v1, so it
// is left a bit below average here — just nudged up — while assassin is nudged down.
// Role order preserved (assassin burstiest, defender tankiest, sage heal-reliant).
export const ROLE_STAT_MULT: Record<PetRole, StatMult> = {
    defender: { hp: 1.10, attack: 0.94, defense: 1.10, speed: 0.94 }, // armored wall
    tracker: { hp: 1.08, attack: 1.12, defense: 1.02, speed: 1.08 }, // ranged pressure (shines in arena)
    assassin: { hp: 0.93, attack: 1.04, defense: 0.93, speed: 1.06 }, // burst, toned down
    sage: { hp: 1.04, attack: 0.88, defense: 1.02, speed: 0.98 }, // backline support
};
export const SUBROLE_STAT_MULT: Record<PetSubRole, StatMult> = {
    tank: { hp: 1.02, attack: 0.95, defense: 1.10, speed: 0.98 }, // mitigation wall
    bruiser: { hp: 1.10, attack: 1.08, defense: 0.90, speed: 1.00 }, // HP + ATK, less armor
    assassin: { hp: 0.94, attack: 1.08, defense: 0.96, speed: 1.02 }, // peak burst
    striker: { hp: 1.05, attack: 0.98, defense: 1.00, speed: 1.06 }, // faster skirmisher
    kite: { hp: 0.97, attack: 1.02, defense: 0.94, speed: 1.08 }, // evasive poke
    control: { hp: 1.03, attack: 0.98, defense: 1.05, speed: 0.94 }, // zoner / sustain
    support: { hp: 1.02, attack: 0.94, defense: 1.02, speed: 0.98 }, // heal/shield
};

// The default (primary) sub-role for each role — used when something assigns a
// role without a sub-role (e.g. the admin Pet Editor's role dropdown).
export const PRIMARY_SUBROLE: Record<PetRole, PetSubRole> = {
    defender: "tank", tracker: "kite", assassin: "assassin", sage: "support",
};

/** Combined base-stat multiplier for a role + sub-role. */
export function roleStatMult(role: PetRole, subRole: PetSubRole): StatMult {
    const r = ROLE_STAT_MULT[role], s = SUBROLE_STAT_MULT[subRole];
    return { hp: r.hp * s.hp, attack: r.attack * s.attack, defense: r.defense * s.defense, speed: r.speed * s.speed };
}

// ── Derivation ────────────────────────────────────────────────────────────────

// Cycle order for the even %4 role assignment. Cycling by id-variant keeps the
// split ~even per rarity tier (n/4 each) AND spans all four roles within each
// 5-pet element block (variants v..v+4 → def, trk, asn, sage, def), so an element
// is never a wall of one role and no per-element shift is needed.
const ROLE_CYCLE: PetRole[] = ["defender", "tracker", "assassin", "sage"];

/** Numeric variant suffix of an id like "standard-12" or "wolf-3-mythic" → 12 / 3. */
export function petVariantOf(id: string): number {
    return Math.max(0, Number(id.match(/-(\d+)(?:-|$)/)?.[1] ?? 0));
}

// Explicit STARTER roles — the 5 element starters, hand-assigned so all 4 roles
// are covered (Assassin doubles: Fire striker + Lightning assassin). Matches each
// starter's authored identity (see starter-pets.ts). Keyed by id PREFIX so the
// starter evolutions (`starter-fire-stage2`, …) inherit their base form's role.
const STARTER_ROLE: Record<string, { role: PetRole; subRole: PetSubRole }> = {
    "starter-fire": { role: "assassin", subRole: "striker" },   // Cinder Cub — aggressive striker
    "starter-water": { role: "sage", subRole: "support" },      // Ripple Seal — sustain support
    "starter-wind": { role: "tracker", subRole: "kite" },       // Gale Chick — swift skirmisher
    "starter-lightning": { role: "assassin", subRole: "assassin" }, // Spark Pup — burst glass-cannon
    "starter-earth": { role: "defender", subRole: "tank" },     // Pebble Tortoise — guardian tank
};

// Explicit MYTHIC roles — the 10 flagships, mapped to the role their HAND-CRAFTED
// KIT actually fits (heal→sage, taunt/barrier→defender, mark/wound/dot→assassin,
// debuff/freeze/mark→tracker), so a mythic's role, stats and kit all agree. The
// phoenix (Suzaku) + the moon-fox (Eclipse Kitsune, reworked support kit) are the
// two Sages — both carry a heal. Spread: 3 assassin / 3 defender / 2 tracker /
// 2 sage.
const MYTHIC_ROLE: Record<string, { role: PetRole; subRole: PetSubRole }> = {
    "Eclipse Kitsune": { role: "sage", subRole: "support" },        // moon-sage — heal/shield/ward
    "Worldstorm Dragon": { role: "assassin", subRole: "striker" },  // stun/haste/dot burst
    "Ancient Frost Titan": { role: "defender", subRole: "tank" },   // taunt + freeze fortress
    "Solar Stag": { role: "tracker", subRole: "control" },          // debuff/mark/burn zoner
    "Abyssal Oni Hound": { role: "assassin", subRole: "assassin" }, // wound/dot/lifesteal brawler
    "Vermillion Suzaku": { role: "sage", subRole: "support" },      // phoenix — heal + sustain
    "Azure Ryujin": { role: "defender", subRole: "tank" },          // taunt + barrier + freeze, bulky
    "Turtle Duck": { role: "tracker", subRole: "control" },         // trickster — debuff/confuse/mark
    "Stormgod Raijin": { role: "assassin", subRole: "striker" },    // stun/haste burst
    "Worldroot Colossus": { role: "defender", subRole: "tank" },    // taunt + heal immovable
};

/**
 * Pick the in-role sub-role for an (element, role) — element theme decides the
 * primary, variant parity alternates to the role's other sub-role for variety
 * (so every element spans several archetypes). Aggressive elements (Fire/Wind/
 * Lightning) lean to the offensive sub-role; defensive (Water/Earth) to the
 * sturdy/controlling one. Sage is always `support` so EVERY sage carries an ally
 * heal (owner hard requirement) — `control` stays a Tracker sub-role.
 */
function subRoleFor(element: JutsuElement | undefined, role: PetRole, variant: number): PetSubRole {
    const [primary, alt] = SUBROLES_OF_ROLE[role];
    const aggressive = element === "Fire" || element === "Wind" || element === "Lightning";
    const even = variant % 2 === 0;
    switch (role) {
        case "defender": return aggressive ? (even ? "bruiser" : "tank") : (even ? "tank" : "bruiser");
        case "assassin": return aggressive ? (even ? "assassin" : "striker") : (even ? "striker" : "assassin");
        case "tracker": return aggressive ? (even ? "kite" : "control") : (even ? "control" : "kite");
        case "sage": return "support";
        default: return primary ?? alt;
    }
}

/**
 * Legacy single-call archetype lookup (element, variant) → sub-role. Kept for
 * back-compat (re-exported from pet-balance) + the kit themer's tests. Delegates
 * to the same role cycle + sub-role themer as derivePetRole (no overrides).
 */
export function petTemplateArchetype(element: JutsuElement | undefined, variant: number): PetSubRole {
    const v = Math.max(0, Math.floor(variant) || 0);
    const role = ROLE_CYCLE[(v % ROLE_CYCLE.length + ROLE_CYCLE.length) % ROLE_CYCLE.length];
    return subRoleFor(element, role, v);
}

/**
 * The native role + sub-role for a pet. Starter ids and mythic names use explicit
 * overrides; everything else gets the even %4 cycle so the pool stays ~25% per
 * role. Pure + deterministic.
 */
export function derivePetRole(pet: Pick<Pet, "id" | "name" | "element" | "rarity">): { role: PetRole; subRole: PetSubRole } {
    for (const prefix in STARTER_ROLE) {
        if (pet.id === prefix || pet.id.startsWith(prefix + "-")) return STARTER_ROLE[prefix];
    }
    if (pet.rarity === "mythic" && pet.name && MYTHIC_ROLE[pet.name]) return MYTHIC_ROLE[pet.name];
    const variant = petVariantOf(pet.id);
    const role = ROLE_CYCLE[(variant % ROLE_CYCLE.length + ROLE_CYCLE.length) % ROLE_CYCLE.length];
    return { role, subRole: subRoleFor(pet.element, role, variant) };
}

/** Convenience: just the role. */
export function petRoleOf(pet: Pick<Pet, "id" | "name" | "element" | "rarity">): PetRole {
    return derivePetRole(pet).role;
}
