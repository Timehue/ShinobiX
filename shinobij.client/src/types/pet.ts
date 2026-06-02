/*
 * Pet-related types. Pets are the secondary unit in the game — owned by
 * characters, used in Pet Arena duels, sent on expeditions, befriended via
 * encounters, trained, and equipped with up to two pet jutsus each.
 *
 * Extracted from App.tsx. Depends only on JutsuElement from ./core.
 */

import type { JutsuElement } from "./core";

export type PetRarity = "standard" | "rare" | "legendary" | "mythic";

export type PetTrait = "Loyal" | "Aggressive" | "Guardian" | "Swift" | "Lucky" | "Battleborn";

export type PetTrainingType = "strength" | "endurance" | "agility" | "chakra" | "bond";

export type PetExpeditionType = "scout" | "forage" | "ruins";

export type PetExpedition = {
    type: PetExpeditionType;
    endsAt: number;
    startedAt: number;
    durationMs: number;
};

// Pet loadout — four equip slots surfaced in the Pet Yard. The Collar slot is
// functional (holds a Glow Collar item id that wraps the pet in a glowing aura
// during pet battles and when it's summoned in a PvE fight). The remaining
// slots are visual scaffolds for now — they hold an item id but nothing
// populates them yet, and the `consumable` (intended to be spent when the pet
// enters PvP or PvE) has no consumption logic wired in. Effects layered later.
export type PetLoadout = {
    collar?: string;        // cosmetic collar — equips a glowing battle aura
    pvp?: string;           // PvP arena gear (unlock-style; no durability)
    pve?: string;           // PvE summon gear — consumable, has durability
    pveDurability?: number; // remaining summons before the PvE gear breaks
    consumable?: string;    // single-use, spent in both PvP and PvE
};

export type PetJutsu = {
    name: string;
    power: number;
    cooldown: number;
    currentCooldown: number;
    // Combat effects. New status kinds added for variety:
    //   burn   — DoT (15% of power per round) + small ATK debuff
    //   freeze — chance to skip next turn each round (50%)
    //   confuse — chance to hit yourself instead of the target (50%)
    //   stun   — guaranteed skip of next turn (1 round)
    //   crush  — Earth special: direct damage + larger ATK/DEF strip.
    //            Plain "debuff" feels numerically weak compared to stun/
    //            freeze/confuse/burn because the player can't SEE the
    //            prevented damage — crush adds an impact moment.
    // Existing kinds (damage/buff/heal/debuff/dot/move/barrier/movelock/
    // lifesteal/shield/absorb) keep their original behavior.
    // Phase 12 archetype-identity kinds (pet battles ONLY — never player combat):
    //   wound — DoT that also halves healing the target receives (bruiser/poison)
    //   mark  — the next damage hit on the target deals bonus damage (assassin)
    //   slow  — target loses a step of movement + some dodge for N rounds (ice/control)
    //   haste — SELF buff: +movement + dodge for N rounds (fast/lightning)
    //   taunt — forces the target to attack the taunter in 2v2 (tank); 1v1 = a small self-guard
    //   push  — light damage + shove the target one tile away (bruiser); Brace negates the shove
    //   pull  — light damage + drag the target one tile closer (control); Brace negates the drag
    kind: "damage" | "buff" | "heal" | "debuff" | "dot" | "move" | "barrier" | "movelock" | "lifesteal" | "shield" | "absorb"
        | "burn" | "freeze" | "confuse" | "stun" | "crush"
        | "wound" | "mark" | "slow" | "haste" | "taunt" | "push" | "pull";
    // Optional duration override for status-effect kinds. Lets a Mythic
    // freeze last 3 rounds while a Standard freeze lasts 1. Defaults are
    // baked into each status handler if rounds is undefined.
    rounds?: number;
    // Marks this jutsu as the pet's dedicated finisher — the strongest hit in
    // its kit, themed to its element. Drives the cinematic signature cut-in in
    // the Pet Arena replay (petSignatureJutsu prefers the flagged move). Pure
    // combat-wise it's an ordinary lifesteal/crush jutsu; the flag is only used
    // to pick which move triggers the cut-in.
    signature?: boolean;
    // Marks this jutsu as area-of-effect — in 2v2 it strikes BOTH enemies (or
    // all allies for support kinds) at a reduced per-target rate (see
    // PET_AOE_DAMAGE_MULT). Optional + additive; nothing sets it yet, so 1v1
    // and existing saves are unaffected.
    aoe?: boolean;
};

export type Pet = {
    id: string;
    name: string;
    rarity: PetRarity;
    level: number;
    xp: number;
    maxLevel: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    image?: string;
    // Optional transparent FULL-BODY battle sprite (distinct from `image`, the
    // circular portrait). When present — or when a `petbody:<id>` shared image
    // exists — the Pet Arena renders the pet un-clipped as a full-body sprite
    // instead of a clipped circular icon. Purely cosmetic; nothing writes it
    // yet, so existing saves are unaffected.
    bodyImage?: string;
    description?: string;
    jutsus: PetJutsu[];
    unlockedForPve: boolean;
    trait?: PetTrait;
    happiness?: number;
    training?: { type: PetTrainingType; endsAt: number; durationMs?: number };
    expedition?: PetExpedition;
    moveRange?: number; // tiles moved per turn (2–5); defaults to 2
    nickname?: string;
    // Equip-slot loadout (Collar / PVP / PVE / Consumable). See PetLoadout.
    // Undefined until the player equips something.
    loadout?: PetLoadout;
    // Optional elemental affinity. Drives the Pet Arena type-effectiveness
    // matchup: Fire > Wind > Lightning > Earth > Water > Fire. Pets without
    // an element (or with "None") fight neutral against everything.
    element?: JutsuElement;
};
