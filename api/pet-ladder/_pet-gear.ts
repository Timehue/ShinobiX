/*
 * Server-side port of the PvP gear + battle-consumable helpers the pet engines read.
 * Hand-duplicated from shinobij.client/src/data/pet-config.ts (the cPanel server build
 * excludes shinobij.client). KEEP IN SYNC — the values here MUST match the client table
 * verbatim or the deterministic ladder sim would diverge from the client cinematic.
 * Companion to the static-text guards in api/_cross-build-parity.test.ts.
 */

import type { Pet } from "./_pet-types.js";

export type PetPvpGear = {
    id: string;
    name: string;
    rarity: "legendary" | "mythic";
    cost: number;
    desc: string;
    atkPct?: number;
    defPct?: number;
    hpPct?: number;
    spdPct?: number;
    shieldStartPctOfHp?: number;
    dotOnHitPctOfAtk?: number;
    dotOnHitRounds?: number;
    executeBelowPct?: number;
    executeBonusPct?: number;
    lastStandBelowPct?: number;
    lastStandReductionPct?: number;
    lifestealPctOfDamage?: number;
};

export const petPvpGear: PetPvpGear[] = [
    { id: "pvp-spiked-war-harness",     name: "Spiked War Harness",       rarity: "legendary", cost: 100, desc: "+15% Attack",                                  atkPct: 15 },
    { id: "pvp-ironhide-barding",       name: "Ironhide Barding",         rarity: "legendary", cost: 100, desc: "+15% Defense",                                 defPct: 15 },
    { id: "pvp-berserkers-muzzle",      name: "Berserker's Muzzle",       rarity: "legendary", cost: 110, desc: "+25% Attack, −12% Defense",                    atkPct: 25, defPct: -12 },
    { id: "pvp-tortoise-shell-plating", name: "Tortoise Shell Plating",   rarity: "legendary", cost: 110, desc: "+25% Defense, −12% Attack",                    defPct: 25, atkPct: -12 },
    { id: "pvp-aegis-pendant",          name: "Aegis Pendant",            rarity: "legendary", cost: 120, desc: "Start each battle with a shield (25% max HP)",  shieldStartPctOfHp: 25 },
    { id: "pvp-venomfang-bit",          name: "Venomfang Bit",            rarity: "mythic",    cost: 130, desc: "Basic attacks poison the foe for 2 rounds",     dotOnHitPctOfAtk: 30, dotOnHitRounds: 2 },
    { id: "pvp-executioners-talon",     name: "Executioner's Talon",      rarity: "mythic",    cost: 140, desc: "+30% damage to foes below 40% HP",             executeBelowPct: 40, executeBonusPct: 30 },
    { id: "pvp-final-bastion-charm",    name: "Final Bastion Charm",      rarity: "mythic",    cost: 140, desc: "−30% damage taken while below 30% HP",         lastStandBelowPct: 30, lastStandReductionPct: 30 },
    { id: "pvp-bloodthirster-fang",     name: "Bloodthirster Fang",       rarity: "mythic",    cost: 140, desc: "Heal 15% of basic-attack damage dealt",        lifestealPctOfDamage: 15 },
    { id: "pvp-arena-champion-regalia", name: "Arena Champion's Regalia", rarity: "mythic",    cost: 150, desc: "+10% to all stats",                            atkPct: 10, defPct: 10, hpPct: 10, spdPct: 10 },
];

export function petPvpGearById(gearId?: string): PetPvpGear | undefined {
    return gearId ? petPvpGear.find((g) => g.id === gearId) : undefined;
}

/** Apply the pet's equipped PVP gear passive stat mods (atk/def/hp/spd). Pure. */
export function applyPetPvpGear(pet: Pet): Pet {
    const gear = petPvpGearById(pet.loadout?.pvp);
    if (!gear) return pet;
    const scale = (base: number, pct?: number) => pct ? Math.max(1, Math.round(base * (1 + pct / 100))) : base;
    return {
        ...pet,
        attack:  scale(pet.attack,  gear.atkPct),
        defense: scale(pet.defense, gear.defPct),
        hp:      scale(pet.hp,      gear.hpPct),
        speed:   scale(pet.speed,   gear.spdPct),
    };
}

/** Flat shield HP granted at battle start (0 if none). */
export function petGearStartShield(pet: Pet): number {
    const g = petPvpGearById(pet.loadout?.pvp);
    return g?.shieldStartPctOfHp ? Math.max(1, Math.round(pet.hp * g.shieldStartPctOfHp / 100)) : 0;
}

/** Outgoing-damage multiplier from the attacker's execute gear vs a low-HP foe. */
export function petGearExecuteMult(attacker: Pet, targetHp: number, targetMaxHp: number): number {
    const g = petPvpGearById(attacker.loadout?.pvp);
    if (g?.executeBelowPct && g.executeBonusPct && targetMaxHp > 0 && (targetHp / targetMaxHp) * 100 < g.executeBelowPct) {
        return 1 + g.executeBonusPct / 100;
    }
    return 1;
}

/** Incoming-damage multiplier from the defender's last-stand gear while low. */
export function petGearLastStandMult(defender: Pet, selfHp: number, selfMaxHp: number): number {
    const g = petPvpGearById(defender.loadout?.pvp);
    if (g?.lastStandBelowPct && g.lastStandReductionPct && selfMaxHp > 0 && (selfHp / selfMaxHp) * 100 < g.lastStandBelowPct) {
        return Math.max(0.1, 1 - g.lastStandReductionPct / 100);
    }
    return 1;
}

/** DoT to stamp on the foe after a basic-attack hit (null if none). */
export function petGearDotOnHit(attacker: Pet): { damage: number; rounds: number } | null {
    const g = petPvpGearById(attacker.loadout?.pvp);
    if (!g?.dotOnHitPctOfAtk) return null;
    return { damage: Math.max(1, Math.round(attacker.attack * g.dotOnHitPctOfAtk / 100)), rounds: g.dotOnHitRounds ?? 2 };
}

/** HP to heal the attacker for, given basic-attack damage dealt (0 if none). */
export function petGearLifestealHeal(attacker: Pet, damageDealt: number): number {
    const g = petPvpGearById(attacker.loadout?.pvp);
    return g?.lifestealPctOfDamage ? Math.max(1, Math.floor(damageDealt * g.lifestealPctOfDamage / 100)) : 0;
}

// ── Battle consumables (reactive single-charge items) ────────────────────────
export type PetConsumableEffect = "dodge" | "mitigate" | "endure" | "thorns" | "lifeline" | "cleanse";

export const PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT = 35;

export type PetConsumable = {
    id: string;
    name: string;
    rarity: "uncommon" | "rare";
    cost: number;
    craftPts: number;
    desc: string;
    effect: PetConsumableEffect;
    value?: number;
};

export const petConsumables: PetConsumable[] = [
    { id: "consum-phantom-charm",     name: "Phantom Charm",     rarity: "uncommon", cost: 600,  craftPts: 120, desc: "Dodges the next attack",                              effect: "dodge",    value: 1 },
    { id: "consum-smoke-pellet",      name: "Smoke Pellet",      rarity: "uncommon", cost: 600,  craftPts: 120, desc: "The next attack deals 50% less damage",                effect: "mitigate", value: 50 },
    { id: "consum-cleansing-incense", name: "Cleansing Incense", rarity: "uncommon", cost: 700,  craftPts: 140, desc: "Purges all poisons, burns, and control effects once", effect: "cleanse" },
    { id: "consum-thornmail-oil",     name: "Thornmail Oil",     rarity: "rare",     cost: 800,  craftPts: 160, desc: "Reflects 40% of the next attack back at the attacker", effect: "thorns",   value: 40 },
    { id: "consum-lifeline-elixir",   name: "Lifeline Elixir",   rarity: "rare",     cost: 900,  craftPts: 180, desc: "First time below 35% HP, heals 30% of max HP",        effect: "lifeline", value: 30 },
    { id: "consum-second-wind",       name: "Second Wind",       rarity: "rare",     cost: 1000, craftPts: 200, desc: "Survives one lethal blow (drops to 1 HP)",            effect: "endure" },
];

export function petConsumableById(consumableId?: string): PetConsumable | undefined {
    return consumableId ? petConsumables.find((c) => c.id === consumableId) : undefined;
}

/** Reactive-charge values granted to a battle fighter by its equipped consumable. */
export function petConsumableCharges(pet: Pet): { dodge: number; mitigate: number; endure: number; thorns: number; lifeline: number; cleanse: number } {
    const c = petConsumableById(pet.loadout?.consumable);
    return {
        dodge:    c?.effect === "dodge"    ? (c.value ?? 1) : 0,
        mitigate: c?.effect === "mitigate" ? (c.value ?? 50) : 0,
        endure:   c?.effect === "endure"   ? 1 : 0,
        thorns:   c?.effect === "thorns"   ? (c.value ?? 50) : 0,
        lifeline: c?.effect === "lifeline" ? (c.value ?? 30) : 0,
        cleanse:  c?.effect === "cleanse"  ? 1 : 0,
    };
}
