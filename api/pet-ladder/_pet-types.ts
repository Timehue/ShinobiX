/*
 * Minimal server-side Pet types for the ported pet-combat engines (_duel-sim.ts,
 * _arena-sim.ts). The server build (tsconfig.cpanel.json) excludes shinobij.client,
 * so the sims are hand-ported here and these types mirror the combat-relevant subset
 * of shinobij.client/src/types/pet.ts. KEEP IN SYNC with that file — only the fields
 * the sims + gear helpers actually read are duplicated.
 */

export type PetRarity = "standard" | "rare" | "legendary" | "mythic";
export type JutsuElement = "Fire" | "Water" | "Wind" | "Lightning" | "Earth" | "None";
export type PetTrait = "Loyal" | "Aggressive" | "Guardian" | "Swift" | "Lucky" | "Battleborn";
export type PetRole = "defender" | "tracker" | "assassin" | "sage";
export type PetSubRole = "tank" | "bruiser" | "striker" | "assassin" | "kite" | "control" | "support";

// PvP-relevant loadout slots (the gear helpers read `pvp` + `consumable` only).
export type PetLoadout = {
    collar?: string;
    pvp?: string;
    pve?: string;
    pveDurability?: number;
    consumable?: string;
};

export type PetJutsu = {
    name: string;
    power: number;
    cooldown: number;
    currentCooldown?: number;
    kind:
        | "damage" | "buff" | "heal" | "debuff" | "dot" | "move" | "barrier" | "movelock"
        | "lifesteal" | "shield" | "absorb" | "burn" | "freeze" | "confuse" | "stun"
        | "crush" | "wound" | "mark" | "slow" | "haste" | "taunt" | "push" | "pull";
    rounds?: number;
    signature?: boolean;
    aoe?: boolean;
};

export type Pet = {
    id: string;
    name: string;
    rarity: PetRarity;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    element?: JutsuElement;
    trait?: PetTrait;
    role?: PetRole;
    subRole?: PetSubRole;
    jutsus: PetJutsu[];
    loadout?: PetLoadout;
};
