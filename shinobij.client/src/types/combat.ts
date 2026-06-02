/*
 * Combat-related pure types: stats, jutsu, equipment, items, bloodlines,
 * training state. All data shapes — no runtime emit, no helpers. The
 * helper functions that operate on these (normalizeEquipmentSlot,
 * armorReductionForQuality, etc.) stay in App.tsx for now and will move
 * in Pass 3.
 *
 * Extracted from App.tsx.
 */

import type { JutsuType, JutsuElement, JutsuTarget, JutsuMethod, Rank } from "./core";

export type Stats = {
    strength: number;
    speed: number;
    intelligence: number;
    willpower: number;
    bukijutsuOffense: number;
    bukijutsuDefense: number;
    taijutsuOffense: number;
    taijutsuDefense: number;
    genjutsuOffense: number;
    genjutsuDefense: number;
    ninjutsuOffense: number;
    ninjutsuDefense: number;
};

export type JutsuMastery = { jutsuId: string; level: number; xp: number };

export type JutsuTag = { name: string; percent: number };

export type Jutsu = {
    id: string;
    name: string;
    type: JutsuType;
    element: JutsuElement;
    ap: number;
    range: number;
    effectPower: number;
    cooldown: number;
    currentCooldown: number;
    chakraCost: number;
    staminaCost: number;
    healthCost: number;
    target: JutsuTarget;
    method: JutsuMethod;
    battleDescription: string;
    healthCostReducePerLvl: number;
    chakraCostReducePerLvl: number;
    staminaCostReducePerLvl: number;
    tags: JutsuTag[];
    description?: string;
    image?: string;
    bloodlineRank?: Rank; // set on bloodline jutsus; absent = global/starter
    // Explicit "utility = deals no damage" flag. When absent, the legacy 40-AP
    // convention applies (see isZeroDamageFortyApJutsu). Decouples AP cost from
    // whether a jutsu deals damage.
    isUtility?: boolean;
};

export type EquipmentSlot =
    | "aura" | "hand" | "body" | "waist" | "legs" | "feet" | "head"
    | "item" | "thrown" | "weapon" | "armor" | "accessory";

export type ArmorQuality = "Standard" | "Reinforced" | "Rare" | "Elite" | "Legendary" | "Mythic";

export type GameItem = {
    id: string;
    name: string;
    slot: EquipmentSlot;
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
    cost: number;
    description: string;
    armorQuality?: ArmorQuality;
    levelReq?: number;
    image?: string;
    weaponElement?: JutsuElement;
    weaponRange?: number;
    weaponCooldown?: number;
    weaponEp?: number;
    weaponEffect?: "Absorb" | "Lifesteal" | "Reflect" | "Increase Damage Given" | "Decrease Damage Given" | "Decrease Damage Taken" | "Increase Damage Taken" | "Shield" | "Wound" | "Poison";
    weaponEffectValue?: number;
    weaponEffectTarget?: "enemy" | "both"; // "both" = applies effect to both player and enemy (e.g. Smoke Bomb)
    apCost?: number; // override the default AP cost for this item in combat
    weaponTags?: Array<{ name: string; percent: number }>; // Named Weapon multi-tag support
    flavorText?: string; // Player-written flavor text on Named Weapons
    bonuses: Partial<Stats> & {
        maxHp?: number;
        maxChakra?: number;
        maxStamina?: number;
        damagePercent?: number;
        absorbPercent?: number;
        lifeStealPercent?: number;
        shield?: number;
        reflectPercent?: number;
    };
};

export type EquipmentSlots = Partial<Record<EquipmentSlot, string>>;

export type SavedBloodline = {
    id: string;
    name: string;
    rank: Rank;
    image?: string;
    specialElement?: string;
    lore?: string;
    jutsus: Jutsu[];
    totalPoints: number;
};

export type ReviewBloodline = SavedBloodline & {
    ownerName?: string;
    ownerKey?: string;
};

export type ActiveTraining = {
    label: string;
    stat: keyof Stats;
    xp: number;
    statGain: number;
    staminaCost: number;
    endsAt: number;
};

export type ActiveJutsuTraining = {
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    startedAt: number;
    endsAt: number;
};
