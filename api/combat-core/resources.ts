export type ApCostModifiers = {
    lagPct?: number | null;
    overclockPct?: number | null;
};

export function adjustedApCost(base: number, modifiers: ApCostModifiers = {}): number {
    let cost = base;
    if (modifiers.lagPct !== undefined && modifiers.lagPct !== null) {
        cost = Math.ceil(cost * (1 + modifiers.lagPct / 100));
    }
    if (modifiers.overclockPct !== undefined && modifiers.overclockPct !== null) {
        cost = Math.floor(cost * (1 - modifiers.overclockPct / 100));
    }
    return Math.max(1, cost);
}
