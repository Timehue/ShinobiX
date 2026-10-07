/*
 * Gear steps: half point upgrades between built in gear tiers.
 *
 * A step item is a built in weapon or armor piece with a little more power than
 * its base, never reaching the next tier. Weapons gain 0.5 EP per step and armor
 * gains 0.5 percent damage reduction per step. Everything else on the item (the
 * second effect and its percent, tags, stats, passives) is copied from the base.
 *
 *   weapons  common 14 to 17, rare 17 to 19, epic 19 to 22
 *   armor    Standard 1 to 3 percent, Reinforced 3 to 5, Rare 5 to 7
 *
 * Nothing passes Legendary (22 EP, 7 percent). Step items cost 0, so the shop
 * never sells them: they only arrive as drops, and a player can sell one back
 * for GEAR_STEP_SELL_RYO. A player unlocks a tier's steps by buying or crafting
 * an item of that tier (character.gearTierUnlocks).
 *
 * Both the client item list and the server catalog derive from this file, so the
 * two cannot drift.
 */
import { effectiveItemLevelReq } from "./item-level-gate.js";
import { GEAR_STEP_ART_READY } from "./gear-step-art-ready.js";
import { GEAR_STEP_NAMES } from "./gear-step-names.js";

export type GearKind = "weapon" | "armor";

/** Where a step item's own art lives. Only used once its id is in GEAR_STEP_ART_READY. */
export function gearStepArtPath(stepId: string): string {
    return `/items/step-${stepId}-v1.webp`;
}

export const GEAR_STEP_SIZE = 0.5;

/** What any gear step drop sells for, in ryo. Step items cost 0, so the usual half cost rule gives nothing. */
export const GEAR_STEP_SELL_RYO = 500;

/** The next tier's base value for each steppable tier, indexed by tier. */
const WEAPON_NEXT_EP = [17, 19, 22] as const;
const ARMOR_NEXT_PERCENT = [3, 5, 7] as const;

/** Highest tier index that has steps (weapons: epic, armor: Rare). */
export const MAX_STEP_TIER = 2;

const WEAPON_TIER_BY_RARITY: Record<string, number> = {
    common: 0, uncommon: 0, rare: 1, epic: 2, legendary: 3, mythic: 3, named: 3,
};
const ARMOR_TIER_BY_QUALITY: Record<string, number> = {
    Standard: 0, Reinforced: 1, Rare: 2, Elite: 3, Legendary: 3, Mythic: 3,
};
const ARMOR_PERCENT_BY_QUALITY: Record<string, number> = { Standard: 1, Reinforced: 3, Rare: 5 };

const ARMOR_SLOTS = new Set(["head", "body", "legs", "feet", "waist"]);

const WEAPON_WORDS_5 = ["Whetted", "Honed", "Tempered", "Folded", "Shadow Forged"];
const WEAPON_WORDS_3 = ["Honed", "Tempered", "Folded"];
const ARMOR_WORDS = ["Mended", "Lacquered", "Ironstitched"];

type GearLike = {
    id: string;
    name: string;
    slot: string;
    rarity: string;
    cost?: number;
    description: string;
    image?: string;
    levelReq?: number;
    weaponEp?: number;
    armorQuality?: string;
};

const STEP_ID = /^(.+)-s([1-5])$/;

export function stepItemId(baseId: string, step: number): string {
    return `${baseId}-s${step}`;
}

export function parseStepItemId(id: string): { baseId: string; step: number } | null {
    const match = STEP_ID.exec(id);
    return match ? { baseId: match[1], step: Number(match[2]) } : null;
}

export function isStepItemId(id: unknown): boolean {
    return typeof id === "string" && STEP_ID.test(id);
}

function isWeaponBase(item: GearLike): boolean {
    return item.slot === "hand"
        && item.weaponEp != null
        && Number(item.cost) > 0
        && (item.rarity === "common" || item.rarity === "rare" || item.rarity === "epic");
}

function isArmorBase(item: GearLike): boolean {
    return ARMOR_SLOTS.has(item.slot)
        && item.armorQuality != null
        && item.armorQuality in ARMOR_PERCENT_BY_QUALITY;
}

/** Which kind and tier an item belongs to for the unlock rule, or null if it is neither. */
export function gearTierOf(item: Pick<GearLike, "slot" | "rarity" | "weaponEp" | "armorQuality">): { kind: GearKind; tier: number } | null {
    if (item.slot === "hand" && item.weaponEp != null) {
        return { kind: "weapon", tier: WEAPON_TIER_BY_RARITY[item.rarity] ?? 0 };
    }
    if ((ARMOR_SLOTS.has(item.slot) || item.slot === "armor") && item.armorQuality != null) {
        return { kind: "armor", tier: ARMOR_TIER_BY_QUALITY[item.armorQuality] ?? 0 };
    }
    return null;
}

/** How many steps sit between a tier and the next one. */
export function stepCount(kind: GearKind, tier: number): number {
    const gap = kind === "weapon"
        ? WEAPON_NEXT_EP[tier] - [14, 17, 19][tier]
        : ARMOR_NEXT_PERCENT[tier] - [1, 3, 5][tier];
    return Math.round(gap / GEAR_STEP_SIZE) - 1;
}

function stepWord(kind: GearKind, tier: number, step: number): string {
    if (kind === "armor") return ARMOR_WORDS[step - 1];
    return stepCount(kind, tier) === 5 ? WEAPON_WORDS_5[step - 1] : WEAPON_WORDS_3[step - 1];
}

function buildStep<T extends GearLike>(base: T, kind: GearKind, tier: number, step: number, artReady: ReadonlySet<string>): T {
    const value = kind === "weapon"
        ? Number(base.weaponEp) + step * GEAR_STEP_SIZE
        : ARMOR_PERCENT_BY_QUALITY[String(base.armorQuality)] + step * GEAR_STEP_SIZE;
    const id = stepItemId(base.id, step);
    const out: T = {
        ...base,
        id,
        name: GEAR_STEP_NAMES[id] ?? `${stepWord(kind, tier, step)} ${base.name}`,
        cost: 0,
        levelReq: effectiveItemLevelReq(base),
        // Its own art once that exists, the base item's art until then.
        ...(artReady.has(id) ? { image: gearStepArtPath(id) } : {}),
    };
    if (kind === "weapon") {
        out.weaponEp = value;
        // The base's flavor line describes the base's own look, so it is replaced. The
        // bracketed stat block (damage, effect and its percent, AP, range, cooldown) is
        // kept as is, with only the damage changed.
        const block = /\[[^\]]*\]/.exec(base.description)?.[0];
        const stats = block ? block.replace(/Damage \d+(?:\.\d+)? EP/, `Damage ${value} EP`) : `Damage ${value} EP.`;
        out.description = `A prized find that outclasses the ${base.name}. ${stats}`;
    } else {
        (out as GearLike & { armorReduction?: number }).armorReduction = value / 100;
        const basePercent = ARMOR_PERCENT_BY_QUALITY[String(base.armorQuality)];
        out.description = `A prized find that outclasses the ${base.name}: ${value}% damage reduction, up from ${basePercent}%.`;
    }
    return out;
}

/** Every step item for the given base catalog, in a stable order. `artReady` is a parameter so a test can prove the switch. */
export function buildGearSteps<T extends GearLike>(items: readonly T[], artReady: ReadonlySet<string> = new Set(GEAR_STEP_ART_READY)): T[] {
    const out: T[] = [];
    for (const base of items) {
        const kind: GearKind | null = isWeaponBase(base) ? "weapon" : isArmorBase(base) ? "armor" : null;
        if (!kind) continue;
        const tier = gearTierOf(base)?.tier ?? 0;
        if (tier > MAX_STEP_TIER) continue;
        const count = stepCount(kind, tier);
        for (let step = 1; step <= count; step++) out.push(buildStep(base, kind, tier, step, artReady));
    }
    return out;
}
