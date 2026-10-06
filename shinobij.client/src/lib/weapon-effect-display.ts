/*
 * What a weapon's effect really does, for item cards.
 *
 * A weapon swing has no jutsu mastery row and no bloodline rank, so the server
 * (api/pvp/move.ts, shared by PvP, Solo PvE and Battle Towers) resolves it like this:
 *   • Heal and Shield are flat amounts (owner rulings 2026-10-06). A built-in
 *     catalog weapon grants its authored amount (Frostfang Oathblade 300, Glacier
 *     King Cleaver 400). A forged Named Weapon follows its distinct tag count:
 *     450 when it is the blade's only tag, 225 each beside another. Anything else
 *     swings at mastery 0: the swing's 30% share of a jutsu's 750.
 *   • Drain is unmitigated (nothing reduces a tick). A built-in weapon ticks at
 *     its 50 floor; a Named Weapon ticks 150 as its only tag, 75 beside another.
 *     The stored value is never read.
 *   • Percentage buffs answer to the weapon amp ceiling (WEAPON_AMP_TAG_CAP, 35),
 *     Wound to the basic-rank Wound cap (25) and Poison to WEAPON_POISON_TAG_CAP.
 *     A Wound bleeds that percent of the damage the swing caused, per turn.
 * Cards used to print the stored number with a "%" — the Frostfang Oathblade read
 * "Shield 300%" and the Ranked Kunai "Wound 300%".
 */
import { HEAL_FLAT_PVE, SHIELD_FLAT_PVE, drainTickPVE, masteryDamageFrac } from "./combat-math";
import { cappedDamageTags, normalizeTagName, weaponTagCombatPercent } from "./tags";
import { starterItems } from "../data/starter-items";
import { isForgedNamedWeaponId } from "../../../shared/named-forge-roll";

/** Mirrors WEAPON_AMP_TAG_CAP in api/combat-core/formulas.ts. */
export const WEAPON_AMP_TAG_CAP = 35;
/** Mirrors WOUND_CAP_BY_RANK.basic in api/combat-core/formulas.ts (a weapon has no rank). */
export const WEAPON_WOUND_TAG_CAP = 25;

/** Built-in weapons: the mastery-0 swing amounts. */
export const WEAPON_FLAT_TAG_AMOUNTS = {
    Heal: Math.floor(HEAL_FLAT_PVE * masteryDamageFrac(0)),
    Shield: Math.floor(SHIELD_FLAT_PVE * masteryDamageFrac(0)),
    Drain: drainTickPVE(0),
} as const;

/** Named Weapons — mirror WEAPON_FLAT_TAG_* / WEAPON_DRAIN_TICK_* in api/combat-core/formulas.ts. */
export const WEAPON_FLAT_TAG_SOLO = 450;
export const WEAPON_FLAT_TAG_SPLIT = 225;
export const WEAPON_DRAIN_TICK_SOLO = 150;
export const WEAPON_DRAIN_TICK_SPLIT = 75;

type WeaponLike = { id?: string; weaponEffect?: string; weaponTags?: Array<{ name: string }> };

/** Distinct tags a swing carries: its weaponTags plus a legacy weaponEffect. */
export function weaponDistinctTagCount(item: WeaponLike): number {
    const names = new Set((item.weaponTags ?? []).map((t) => normalizeTagName(t.name)));
    if (item.weaponEffect) names.add(normalizeTagName(item.weaponEffect));
    return names.size;
}

/** Mirrors catalogWeaponFlatTags in api/pvp/move.ts: a built-in's authored Heal/Shield. */
function builtInFlatAmount(itemId: string | undefined, tag: "Heal" | "Shield" | "Drain"): number | undefined {
    if (!itemId || tag === "Drain") return undefined;
    const item = starterItems.find((i) => i.id === itemId);
    const value = Number(item?.weaponEffectValue);
    const ceiling = tag === "Heal" ? HEAL_FLAT_PVE : SHIELD_FLAT_PVE;
    return String(item?.weaponEffect) === tag && value > 0 ? Math.min(ceiling, value) : undefined;
}

/** The flat Heal/Shield/Drain a swing of this weapon gives (the server decides; this mirrors it). */
export function weaponFlatTagAmountFor(item: WeaponLike | undefined, tag: "Heal" | "Shield" | "Drain"): number {
    if (!item || !isForgedNamedWeaponId(item.id)) return builtInFlatAmount(item?.id, tag) ?? WEAPON_FLAT_TAG_AMOUNTS[tag];
    const solo = weaponDistinctTagCount(item) <= 1;
    if (tag === "Drain") return solo ? WEAPON_DRAIN_TICK_SOLO : WEAPON_DRAIN_TICK_SPLIT;
    return solo ? WEAPON_FLAT_TAG_SOLO : WEAPON_FLAT_TAG_SPLIT;
}

/**
 * A freshly ROLLED Named Weapon tag (no item id yet): Heal/Shield/Drain show the
 * flat amount the blade will grant; everything else shows its rolled percent.
 */
export function namedRollTagValue(name: string, percent: number, distinctTagCount: number): string {
    const solo = distinctTagCount <= 1;
    if (name === "Heal") return `${solo ? WEAPON_FLAT_TAG_SOLO : WEAPON_FLAT_TAG_SPLIT} HP`;
    if (name === "Shield") return `${solo ? WEAPON_FLAT_TAG_SOLO : WEAPON_FLAT_TAG_SPLIT} shield`;
    if (name === "Drain") return `${solo ? WEAPON_DRAIN_TICK_SOLO : WEAPON_DRAIN_TICK_SPLIT} HP + chakra per turn`;
    return `${percent}%`;
}

export function weaponEffectDisplayValue(name: string, value: number | undefined, item?: WeaponLike): string {
    const tag = normalizeTagName(name);
    if (tag === "Heal") return `${weaponFlatTagAmountFor(item, "Heal")} HP`;
    if (tag === "Shield") return `${weaponFlatTagAmountFor(item, "Shield")} shield`;
    if (tag === "Drain") return `${weaponFlatTagAmountFor(item, "Drain")} HP + chakra per turn`;
    const pct = weaponTagCombatPercent(tag, Math.max(0, Number(value) || 0));
    if (tag === "Wound") return `${Math.min(pct, WEAPON_WOUND_TAG_CAP)}% of damage dealt`;
    if (cappedDamageTags.includes(tag)) return `${Math.min(pct, WEAPON_AMP_TAG_CAP)}%`;
    return `${pct}%`;
}
