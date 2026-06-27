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
    // Epoch-ms recency stamp, set when an admin creates/edits a jutsu in the
    // editor. Used by the shared-admin-content merge to keep the NEWER copy when
    // the same jutsu id exists in more than one admin save — without it the
    // last-pulled (often stale) copy clobbers a fresh edit. Absent on content
    // never touched by the new editor path (treated as oldest).
    updatedAt?: number;
    bloodlineRank?: Rank; // set on bloodline jutsus; absent = global/starter
    // Explicit "utility = deals no damage" flag. When absent, the legacy 40-AP
    // convention applies (see isZeroDamageFortyApJutsu). Decouples AP cost from
    // whether a jutsu deals damage.
    isUtility?: boolean;
    // Mechanical element for the WEATHER system, decoupled from the cosmetic
    // `element` (which carries a bloodline's flavor name, e.g. "Crystal"). One
    // of the five base elements → gains/loses damage with matching weather;
    // "None" → no weather buff or debuff. Set on bloodline jutsu by the Bloodline
    // Maker; absent on starters/items, which fall back to `element`.
    weatherElement?: JutsuElement;
};

export type EquipmentSlot =
    | "aura" | "hand" | "gloves" | "body" | "waist" | "legs" | "feet" | "head"
    // "item" is the canonical slot a combat item (Attack/Defense Pill, Smoke Bomb)
    // is AUTHORED on; item1/item2/item3 are the three dedicated equipment KEYS it
    // equips into so all three can be carried at once (legacy bare "item" is kept
    // for back-compat with saves that stored a single combat item there).
    | "item" | "item1" | "item2" | "item3" | "thrown" | "potion" | "weapon" | "armor" | "accessory";

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
    // Flat in-battle restore (potions). Applied directly to the current
    // chakra/stamina pool (clamped to max) when the item is USED — NOT a
    // passive stat bonus, so equipping the item never inflates maxChakra/
    // maxStamina. Distinct from bonuses.maxChakra (which the old 0.35×max
    // consumable formula keyed off and which DOES raise the cap when worn).
    restoreChakra?: number;
    restoreStamina?: number;
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
    // Bloodline-wide weather affinity: which base element (or "None") the
    // special element behaves as for the weather system. Stamped onto every
    // jutsu's weatherElement on save.
    weatherElement?: JutsuElement;
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
    // Total run length in ms, recorded at start so a cancel can prorate the
    // reward by elapsed time. Optional: saves created before this field shipped
    // fall back to a label-based duration lookup.
    durationMs?: number;
};

// A 2nd jutsu training lined up behind the active one. Ryo is paid up-front at
// queue time and the duration is locked then (training bonuses baked in), so when
// the active training completes the queue auto-promotes with no further cost.
export type QueuedJutsuTraining = {
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    durationMs: number;
};

export type ActiveJutsuTraining = {
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    startedAt: number;
    endsAt: number;
    // Optional queued 2nd training; auto-promotes to active on completion.
    // See lib/jutsu-training-queue.ts (global runner) + screens/Training.tsx (UI).
    next?: QueuedJutsuTraining | null;
};
