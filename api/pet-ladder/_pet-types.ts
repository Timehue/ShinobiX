/*
 * Minimal server-side Pet types for the pet ladder's frozen snapshots
 * (_core.ts). The server build excludes shinobij.client, so these types mirror
 * the combat-relevant subset of shinobij.client/src/types/pet.ts. KEEP IN SYNC
 * with that file — only the fields the ladder snapshots carry are duplicated.
 *
 * Both hand-ported engines that used to sit beside these types are gone: the
 * ladder's coliseum duels resolve on the Showdown engine (api/_pet-showdown/)
 * and its tactical matches on the Warfront Rite (api/_pet-sim/), so the copied
 * _duel-sim.ts and, on 2026-10-02, the _arena-sim.ts Tactical Arena were deleted
 * rather than kept in sync with nothing.
 */

export type PetRarity = "standard" | "rare" | "legendary" | "mythic";
export type JutsuElement = "Fire" | "Water" | "Wind" | "Lightning" | "Earth" | "None";
export type PetTrait =
    | "Loyal" | "Aggressive" | "Guardian" | "Swift" | "Lucky" | "Battleborn"
    | "Fateweaver" | "Hollowborn" | "Boonbringer";
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
    templateId?: string;
    evolutionStage?: 0 | 1 | 2;
    paletteVariantId?: string;
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
