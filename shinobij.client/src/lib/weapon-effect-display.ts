/*
 * What a weapon's effect really does, for item cards.
 *
 * A weapon swing has no jutsu mastery row and no bloodline rank, so the server
 * (api/pvp/move.ts, shared by PvP, Solo PvE and Battle Towers) resolves it like this:
 *   • Heal and Shield are flat amounts at mastery 0: the swing's 30% share of a
 *     jutsu's 750. The stored value is never read.
 *   • Drain ticks at its 50 floor, in full (armor does not reduce a Drain).
 *     The stored value is never read.
 *   • Percentage buffs answer to the weapon amp ceiling (WEAPON_AMP_TAG_CAP, 35),
 *     Wound to the basic-rank Wound cap (25) and Poison to WEAPON_POISON_TAG_CAP.
 *     A Wound bleeds that percent of the damage the swing caused, per turn.
 * Cards used to print the stored number with a "%" — the Frostfang Oathblade read
 * "Shield 300%" and the Ranked Kunai "Wound 300%".
 */
import { HEAL_FLAT_PVE, SHIELD_FLAT_PVE, drainTickPVE, masteryDamageFrac } from "./combat-math";
import { cappedDamageTags, normalizeTagName, weaponTagCombatPercent } from "./tags";

/** Mirrors WEAPON_AMP_TAG_CAP in api/combat-core/formulas.ts. */
export const WEAPON_AMP_TAG_CAP = 35;
/** Mirrors WOUND_CAP_BY_RANK.basic in api/combat-core/formulas.ts (a weapon has no rank). */
export const WEAPON_WOUND_TAG_CAP = 25;

export const WEAPON_FLAT_TAG_AMOUNTS = {
    Heal: Math.floor(HEAL_FLAT_PVE * masteryDamageFrac(0)),
    Shield: Math.floor(SHIELD_FLAT_PVE * masteryDamageFrac(0)),
    Drain: drainTickPVE(0),
} as const;

export function weaponEffectDisplayValue(name: string, value: number | undefined): string {
    const tag = normalizeTagName(name);
    if (tag === "Heal") return `${WEAPON_FLAT_TAG_AMOUNTS.Heal} HP`;
    if (tag === "Shield") return `${WEAPON_FLAT_TAG_AMOUNTS.Shield} shield`;
    if (tag === "Drain") return `${WEAPON_FLAT_TAG_AMOUNTS.Drain} HP + chakra per turn`;
    const pct = weaponTagCombatPercent(tag, Math.max(0, Number(value) || 0));
    if (tag === "Wound") return `${Math.min(pct, WEAPON_WOUND_TAG_CAP)}% of damage dealt`;
    if (cappedDamageTags.includes(tag)) return `${Math.min(pct, WEAPON_AMP_TAG_CAP)}%`;
    return `${pct}%`;
}
