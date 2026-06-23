/*
 * pet-synergies — the Pet Gauntlet team-composition layer.
 *
 * The Gauntlet's depth comes from WHICH pets you draft together, not from the
 * fight (the fight is the deterministic continuous duel). Fielding pets that
 * share an ELEMENT or a battle ROLE activates a tiered, squad-wide bonus — the
 * "trait bar" puzzle of an auto-battler — surfaced from data every pet ALREADY
 * carries (`element` + the 4 battle roles), so no new pet data is needed.
 *
 * Design note (load-bearing): a synergy is expressed purely as a STAT multiplier
 * (attack/hp/defense/speed). The draft applies the active bonuses to the run-only
 * pet COPIES before the fight (`applySynergiesToSquad`), so the duel sim
 * (lib/pet-duel-sim.ts) and its ranked server twin stay BYTE-UNTOUCHED —
 * synergies can never perturb determinism. Richer status-injecting synergies
 * (burn-on-hit, etc.) would need sim support and are intentionally out of v1.
 *
 * Bonuses are TEAM-WIDE (every fielded pet gets them), scaled by how many of the
 * element/role you field — simple to read and to compute. Per-trait "only matching
 * units" buffs are a possible later refinement.
 */

import type { Pet } from "../types/pet";
import { derivePetRole, ROLE_META, type PetRole } from "./pet-roles";

/** The four stats a synergy can modify (the duel sim reads exactly these). */
export type SynergyStat = "attack" | "hp" | "defense" | "speed";

/** One activation threshold: at `count` matching pets, grant `bonus` (additive
 *  percent per stat, e.g. 0.12 = +12%) team-wide. */
export interface SynergyTier {
    count: number;
    bonus: Partial<Record<SynergyStat, number>>;
    note: string;
}

export interface SynergyDef {
    key: string;                       // stable id, e.g. "element:Fire"
    kind: "element" | "role";
    match: string;                     // the element name or PetRole this counts
    label: string;                     // display name ("Ember Pack")
    icon: string;
    color: string;
    flavor: string;
    tiers: SynergyTier[];              // ascending by count; highest reached wins
}

export interface ActiveSynergy {
    def: SynergyDef;
    count: number;                     // how many matching pets are fielded
    tier: SynergyTier;                 // the highest tier whose count is met
    tierIndex: number;                 // 0-based index into def.tiers (for UI dots)
}

const EL = (match: string, label: string, icon: string, color: string, flavor: string, tiers: SynergyTier[]): SynergyDef =>
    ({ key: `element:${match}`, kind: "element", match, label, icon, color, flavor, tiers });

const RL = (match: PetRole, label: string, flavor: string, tiers: SynergyTier[]): SynergyDef =>
    ({ key: `role:${match}`, kind: "role", match, label, icon: ROLE_META[match].icon, color: ROLE_META[match].color, flavor, tiers });

/*
 * Each element leans into its combat identity (fire = aggression, water =
 * sustain, wind = speed, lightning = burst, earth = defense). Two tiers (2 / 4)
 * so a squad of ~4 can chase a deep single-element bonus OR splash two elements
 * at the shallow tier — the core drafting tension.
 */
export const SYNERGY_DEFS: SynergyDef[] = [
    EL("Fire", "Ember Pack", "🔥", "#fb923c", "Fire pets fight with fury — raw attack.", [
        { count: 2, bonus: { attack: 0.12 }, note: "+12% attack" },
        { count: 4, bonus: { attack: 0.28 }, note: "+28% attack" },
    ]),
    EL("Water", "Tidal Bond", "💧", "#38bdf8", "Water pets endure — they flow and outlast.", [
        { count: 2, bonus: { hp: 0.14 }, note: "+14% max HP" },
        { count: 4, bonus: { hp: 0.32 }, note: "+32% max HP" },
    ]),
    EL("Wind", "Galeforce", "🌪️", "#5eead4", "Wind pets are quick — they strike first.", [
        { count: 2, bonus: { speed: 0.16 }, note: "+16% speed" },
        { count: 4, bonus: { speed: 0.36 }, note: "+36% speed" },
    ]),
    EL("Lightning", "Storm Surge", "⚡", "#facc15", "Lightning pets burst — fast, hard hits.", [
        { count: 2, bonus: { attack: 0.10, speed: 0.08 }, note: "+10% attack, +8% speed" },
        { count: 4, bonus: { attack: 0.22, speed: 0.18 }, note: "+22% attack, +18% speed" },
    ]),
    EL("Earth", "Bulwark", "⛰️", "#a3a380", "Earth pets hold the line — heavy defense.", [
        { count: 2, bonus: { defense: 0.16 }, note: "+16% defense" },
        { count: 4, bonus: { defense: 0.36 }, note: "+36% defense" },
    ]),
    RL("defender", "Phalanx", "Defenders anchor the squad — tougher all round.", [
        { count: 2, bonus: { defense: 0.15, hp: 0.10 }, note: "+15% defense, +10% HP" },
    ]),
    RL("assassin", "Ambush", "Assassins pile on — sharper killing power.", [
        { count: 2, bonus: { attack: 0.16 }, note: "+16% attack" },
    ]),
    RL("sage", "Communion", "Sages sustain the squad — extra vitality.", [
        { count: 2, bonus: { hp: 0.13 }, note: "+13% max HP" },
    ]),
    RL("tracker", "Pack Hunt", "Trackers run their quarry down — extra speed.", [
        { count: 2, bonus: { speed: 0.13 }, note: "+13% speed" },
    ]),
];

/** Element a pet counts toward (null/"None" → counts toward nothing). */
function petElement(pet: Pick<Pet, "element">): string | null {
    const e = pet.element;
    return e && e !== "None" ? e : null;
}

/** Battle role a pet counts toward (uses the stored role, else derives it). */
function petRole(pet: Pet): PetRole {
    return (pet.role as PetRole | undefined) ?? derivePetRole(pet).role;
}

/**
 * Resolve the synergies a squad activates: for each definition, count matching
 * pets and select the highest tier whose threshold is met. Returns only the
 * activated synergies, ordered by kind then strength (elements before roles).
 */
export function resolveSynergies(squad: Pet[]): ActiveSynergy[] {
    const elementCounts = new Map<string, number>();
    const roleCounts = new Map<string, number>();
    for (const pet of squad) {
        const el = petElement(pet);
        if (el) elementCounts.set(el, (elementCounts.get(el) ?? 0) + 1);
        const role = petRole(pet);
        roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
    const active: ActiveSynergy[] = [];
    for (const def of SYNERGY_DEFS) {
        const count = (def.kind === "element" ? elementCounts : roleCounts).get(def.match) ?? 0;
        // Highest tier whose count requirement is satisfied.
        let tierIndex = -1;
        for (let i = 0; i < def.tiers.length; i++) {
            if (count >= def.tiers[i].count) tierIndex = i;
        }
        if (tierIndex >= 0) active.push({ def, count, tier: def.tiers[tierIndex], tierIndex });
    }
    return active;
}

/** Sum the active synergies into one additive per-stat percent bonus. */
export function aggregateSynergyBonus(active: ActiveSynergy[]): Record<SynergyStat, number> {
    const total: Record<SynergyStat, number> = { attack: 0, hp: 0, defense: 0, speed: 0 };
    for (const a of active) {
        for (const stat of Object.keys(a.tier.bonus) as SynergyStat[]) {
            total[stat] += a.tier.bonus[stat] ?? 0;
        }
    }
    return total;
}

/**
 * Apply a squad's active synergies to its pets, returning buffed COPIES (the
 * originals are never mutated). Stats scale by (1 + bonus) and stay integers so
 * the duel sim reads sane values. This is the ONLY place synergies touch combat
 * — bake the buffed copies, then hand them to runPetDuel/runPetPartyDuel.
 */
export function applySynergiesToSquad(squad: Pet[], active = resolveSynergies(squad)): Pet[] {
    const b = aggregateSynergyBonus(active);
    return squad.map((pet) => ({
        ...pet,
        hp: Math.max(1, Math.round(pet.hp * (1 + b.hp))),
        attack: Math.max(1, Math.round(pet.attack * (1 + b.attack))),
        defense: Math.max(0, Math.round(pet.defense * (1 + b.defense))),
        speed: Math.max(1, Math.round(pet.speed * (1 + b.speed))),
    }));
}
