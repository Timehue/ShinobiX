/*
 * Shared turn-auto-pass affordability primitive.
 *
 * Both combat screens decide whether to auto-end the turn by asking "is ANY
 * action still affordable?" — the cheapest of: move/dash, basic attack, each
 * equipped jutsu, and every USABLE weapon / throwable / consumable / potion.
 * The PvP screen (pvpMinActionCost) and the PvE Arena (pveMinActionCost) gather
 * those costs from different data models (pvpItems + pvpAdjustedApCost vs
 * GameItem + adjustedApCost), so the gathering stays per-screen — but the fold
 * to "cheapest affordable" lives HERE so the two can't drift on that step.
 *
 * History: each screen hand-rolled `Math.min(...costs)` and one of them omitted
 * thrown weapons, so a turn auto-passed with ~20 AP left while a 20-AP throwable
 * was still usable. Keep BOTH callers in sync when adding a new action category.
 */
export function minActionCost(actionCosts: number[]): number {
    // Ignore NaN / non-positive entries so one bad cost can't poison Math.min
    // (a NaN would make the whole turn read as "nothing affordable").
    const valid = actionCosts.filter((c) => Number.isFinite(c) && c > 0);
    return valid.length ? Math.min(...valid) : Infinity;
}
