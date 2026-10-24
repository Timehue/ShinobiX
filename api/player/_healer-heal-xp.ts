import { economyDial } from '../_economy-dials.js';

/** The base heal XP cap, before the dial and the rank, mastery and assist bonuses. */
export const HEALER_MAX_XP_PER_HEAL = 100;

/**
 * HEALER_HEAL_XP_MULT (default 2, range 1-2; kill value 1). Framework 3.12 / #37
 * (owner question 13 ships at its stated default): heal XP doubled so Healer
 * rank 10 and mastery are reachable at launch population. Healer XP buys only
 * utility perks (cooldown, chakra, XP), never ryo or PvP power.
 */
export function healerHealXpMult(): number {
    return economyDial('HEALER_HEAL_XP_MULT', 2, { min: 1, max: 2 });
}

/**
 * Base XP for one heal: the share of the target's max HP restored (to full), as
 * a percent capped at 100, times the dial. api/player/heal.ts applies the rank,
 * mastery and raid-assist bonuses on top of this, unchanged.
 */
export function healerBaseHealXp(pctHealed: number): number {
    const pct = Number.isFinite(pctHealed) ? Math.max(0, Math.min(1, pctHealed)) : 0;
    // Floored: a fractional dial (1.5) must never store fractional profession XP.
    return Math.floor(Math.min(HEALER_MAX_XP_PER_HEAL, Math.floor(pct * 100)) * healerHealXpMult());
}
