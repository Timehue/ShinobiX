/*
 * What a weapon swing's tags really do, in words, for the server's own item
 * text: the forged Named Weapon description (api/craft/_named.ts) and the Sunscar
 * Exchange listing (api/festival/_exchange-assets.ts).
 *
 * The numbers come from the same formulas applyJutsu uses for a swing
 * (api/pvp/move.ts). A swing has no bloodline rank and resolves its tag percents
 * at JUTSU_MAX_LEVEL, so:
 *   - Heal, Shield and Drain are flat. A Named Weapon follows its distinct tag
 *     count (450 / 225, Drain 150 / 75), a built-in uses its authored amount, and
 *     anything else gets the mastery-0 amount.
 *   - Amp tags answer to WEAPON_AMP_TAG_CAP, Wound to the basic-rank Wound cap,
 *     Poison to WEAPON_POISON_TAG_CAP, and Increase Generals counts at
 *     WEAPON_GENERALS_TAG_SCALE of that.
 * The text used to print the stored percent, so a blade read "Wound 38%" while it
 * bled 25%, and an Exchange listing read "Heal 37%" for a flat 450 HP.
 * The client mirror is shinobij.client/src/lib/weapon-effect-display.ts.
 */
import { ITEM_CATALOG } from './_item-catalog.js';
import { CAPPED_AMP_TAGS, TAG_ALIASES } from './_tags.js';
import { isForgedNamedWeaponId } from '../../shared/named-forge-roll.js';
import {
    drainTick,
    healAmountForMastery,
    HEAL_FLAT,
    JUTSU_MAX_LEVEL,
    poisonPercentForTag,
    scaledTagPercent,
    shieldAmountForMastery,
    SHIELD_FLAT,
    WEAPON_AMP_TAG_CAP,
    WEAPON_POISON_TAG_CAP,
    WOUND_CAP_BY_RANK,
    WOUND_HARD_CAP_PCT,
    weaponDrainTick,
    weaponFlatTagAmount,
    weaponGeneralsPercent,
} from '../combat-core/formulas.js';

export type CatalogWeaponFlat = Partial<Record<'Heal' | 'Shield', number>>;

/**
 * A BUILT-IN catalog weapon's authored flat Heal/Shield (owner ruling 2026-10-06):
 * built-ins sit on a rarity/level ladder, so the Frostfang Oathblade (legendary)
 * shields 300 and the Glacier King Cleaver (mythic) 400, as their cards say. Only
 * ITEM_CATALOG entries qualify — a player-authored item's value is a clamped
 * percent, not a flat amount — and the jutsu ceiling (HEAL_FLAT/SHIELD_FLAT) bounds it.
 */
export function catalogWeaponFlatTags(itemId: unknown): CatalogWeaponFlat | undefined {
    const item = typeof itemId === 'string' ? ITEM_CATALOG[itemId] : undefined;
    const tag = item?.weaponEffect;
    const value = Number(item?.weaponEffectValue);
    if ((tag !== 'Heal' && tag !== 'Shield') || !(value > 0)) return undefined;
    return { [tag]: Math.min(tag === 'Heal' ? HEAL_FLAT : SHIELD_FLAT, value) };
}

type WeaponLike = { id?: unknown; weaponEffect?: unknown; weaponTags?: unknown };

const canonical = (name: string) => TAG_ALIASES[name] ?? name;

/** Tags applyJutsu resolves without reading a percent: the text names them, no number. */
export const WEAPON_TAGS_WITHOUT_MAGNITUDE: ReadonlySet<string> = new Set([
    'Pierce', 'Stun', 'Barrier', 'Push', 'Pull',
    'Debuff Prevent', 'Buff Prevent', 'Cleanse Prevent', 'Clear Prevent', 'Stun Prevent',
]);

/** Distinct tags a swing carries: its weaponTags plus a legacy weaponEffect. */
export function weaponDistinctTagCount(item: WeaponLike): number {
    const names = new Set<string>();
    for (const tag of Array.isArray(item.weaponTags) ? item.weaponTags : []) {
        const name = tag && typeof tag === 'object' ? (tag as { name?: unknown }).name : undefined;
        if (typeof name === 'string' && name) names.add(canonical(name));
    }
    if (typeof item.weaponEffect === 'string' && item.weaponEffect) names.add(canonical(item.weaponEffect));
    return names.size;
}

/** One tag on a swing of `item`, as the player should read it ("Wound 25% of damage dealt"). */
export function weaponTagEffectText(item: WeaponLike, rawName: string, rawPercent: unknown): string {
    const name = canonical(rawName);
    const percent = Number(rawPercent) || 0;
    const named = isForgedNamedWeaponId(item.id);
    const count = weaponDistinctTagCount(item);
    const builtIn = named ? undefined : catalogWeaponFlatTags(item.id);
    if (name === 'Heal') return `Heal ${named ? weaponFlatTagAmount(count) : builtIn?.Heal ?? healAmountForMastery(0, 1)} HP`;
    if (name === 'Shield') return `Shield ${named ? weaponFlatTagAmount(count) : builtIn?.Shield ?? shieldAmountForMastery(0)}`;
    if (name === 'Drain') return `Drain ${named ? weaponDrainTick(count) : drainTick(0)} HP + chakra per turn`;
    if (WEAPON_TAGS_WITHOUT_MAGNITUDE.has(name)) return name;
    // A missing percent resolves like combat: 30 on the amp scale, 6 for Poison.
    if (name === 'Poison') return `Poison ${poisonPercentForTag(percent, JUTSU_MAX_LEVEL, {}, WEAPON_POISON_TAG_CAP)}%`;
    const pct = Math.floor(scaledTagPercent(percent, JUTSU_MAX_LEVEL, name, undefined, CAPPED_AMP_TAGS, WEAPON_AMP_TAG_CAP));
    if (name === 'Wound') return `Wound ${Math.min(pct, WOUND_CAP_BY_RANK.basic, WOUND_HARD_CAP_PCT)}% of damage dealt`;
    if (name === 'Increase Generals') return `Increase Generals ${weaponGeneralsPercent(pct)}%`;
    return `${name} ${pct}%`;
}
