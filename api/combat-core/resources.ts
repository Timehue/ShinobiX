/**
 * Flat AP swing applied by the two tempo tags.
 *
 * Lag ADDS this to each of the target's action costs for one round; Overclock
 * SUBTRACTS it from the caster's. Both are FLAT and mastery-independent by
 * design (owner ruling 2026-09-01): the old percentage form displayed as
 * "20-30%, scaling with mastery" and no player could tell what a given action
 * would actually cost. Ten AP is one tenth of a turn's pool, so the swing reads
 * directly off the AP bar.
 *
 * The tag's stored `percent` is deliberately NOT consulted — the swing is a
 * game constant, so an authored jutsu cannot buy a bigger discount.
 */
export const TEMPO_AP_SWING = 10;

export type ApCostModifiers = {
    /** Actor has an active Lag status — each action costs TEMPO_AP_SWING more. */
    lagged?: boolean | null;
    /** Actor has an active Overclock status — each action costs TEMPO_AP_SWING less. */
    overclocked?: boolean | null;
};

export function adjustedApCost(base: number, modifiers: ApCostModifiers = {}): number {
    let cost = base;
    if (modifiers.lagged) cost += TEMPO_AP_SWING;
    if (modifiers.overclocked) cost -= TEMPO_AP_SWING;
    // An action never becomes free: Overclock on a 10 AP move still costs 1.
    return Math.max(1, cost);
}
