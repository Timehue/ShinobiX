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
 *   • A Named Weapon's percent tags apply exactly as rolled (owner ruling
 *     2026-10-16). Other weapons' percentage buffs answer to the weapon amp
 *     ceiling (WEAPON_AMP_TAG_CAP, 35) and their Wound to the basic-rank Wound cap
 *     (25). Poison answers to WEAPON_POISON_TAG_CAP everywhere.
 *     A Wound bleeds that percent of the damage the swing caused, per turn.
 * Cards used to print the stored number with a "%" — the Frostfang Oathblade read
 * "Shield 300%" and the Ranked Kunai "Wound 300%".
 */
import { HEAL_FLAT_PVE, SHIELD_FLAT_PVE, drainTickPVE, masteryDamageFrac } from "./combat-math";
import { cappedDamageTags, normalizeTagName, weaponTagCombatPercent } from "./tags";
import { starterItems } from "../data/starter-items";
import { isForgedNamedWeaponId, NAMED_WEAPON_TAG_MAX, NAMED_WEAPON_WOUND_MAX } from "../../../shared/named-forge-roll";

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

/** Mirrors WEAPON_TAGS_WITHOUT_MAGNITUDE in api/pvp/_weapon-tags.ts: no percent is read. */
const WEAPON_TAGS_WITHOUT_MAGNITUDE = new Set([
    "Pierce", "Stun", "Barrier", "Push", "Pull",
    "Debuff Prevent", "Buff Prevent", "Cleanse Prevent", "Clear Prevent", "Stun Prevent",
]);

/** Mirrors POISON_DEFAULT_PCT and scaledTagPercent's 30 for a missing percent (api/combat-core/formulas.ts). */
const MISSING_PERCENT_DEFAULT = 30;
const MISSING_POISON_DEFAULT = 6;

/**
 * A swing's percent tag as the server applies it ("" when the tag has no number).
 * A Named Weapon applies its roll as-is (owner ruling 2026-10-16), bounded only by
 * the forge's top roll; every other weapon answers to the 35 / 25 weapon caps.
 */
function weaponTagPercentText(tag: string, value: number | undefined, named: boolean): string {
    if (WEAPON_TAGS_WITHOUT_MAGNITUDE.has(tag)) return "";
    const raw = Number(value) > 0 ? Number(value) : tag === "Poison" ? MISSING_POISON_DEFAULT : MISSING_PERCENT_DEFAULT;
    const pct = weaponTagCombatPercent(tag, raw);
    if (tag === "Wound") return `${Math.min(pct, named ? NAMED_WEAPON_WOUND_MAX : WEAPON_WOUND_TAG_CAP)}% of damage dealt`;
    if (cappedDamageTags.includes(tag)) return `${Math.min(pct, named ? NAMED_WEAPON_TAG_MAX : WEAPON_AMP_TAG_CAP)}%`;
    return `${pct}%`;
}

/**
 * A freshly ROLLED Named Weapon tag (no item id yet): Heal/Shield/Drain show the
 * flat amount the blade will grant; everything else shows its rolled percent,
 * which is exactly what it applies in combat.
 */
export function namedRollTagValue(name: string, percent: number, distinctTagCount: number): string {
    const solo = distinctTagCount <= 1;
    const tag = normalizeTagName(name);
    if (tag === "Heal") return `${solo ? WEAPON_FLAT_TAG_SOLO : WEAPON_FLAT_TAG_SPLIT} HP`;
    if (tag === "Shield") return `${solo ? WEAPON_FLAT_TAG_SOLO : WEAPON_FLAT_TAG_SPLIT} shield`;
    if (tag === "Drain") return `${solo ? WEAPON_DRAIN_TICK_SOLO : WEAPON_DRAIN_TICK_SPLIT} HP + chakra per turn`;
    return weaponTagPercentText(tag, percent, true);
}

export function weaponEffectDisplayValue(name: string, value: number | undefined, item?: WeaponLike): string {
    const tag = normalizeTagName(name);
    if (tag === "Heal") return `${weaponFlatTagAmountFor(item, "Heal")} HP`;
    if (tag === "Shield") return `${weaponFlatTagAmountFor(item, "Shield")} shield`;
    if (tag === "Drain") return `${weaponFlatTagAmountFor(item, "Drain")} HP + chakra per turn`;
    return weaponTagPercentText(tag, value, isForgedNamedWeaponId(item?.id));
}
