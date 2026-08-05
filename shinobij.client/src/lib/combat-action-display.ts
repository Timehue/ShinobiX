import { statusMatchesName } from "./tags";

export type CombatDisplayStatus = { name: string; percent?: number };

/** Mirrors the shared server resolver's Lag-then-Overclock AP adjustment. */
export function adjustedCombatApCost(statuses: readonly CombatDisplayStatus[] | undefined, base: number): number {
    const lag = statuses?.find((status) => statusMatchesName(status, "Lag"));
    const overclock = statuses?.find((status) => statusMatchesName(status, "Overclock"));
    let cost = Math.max(0, Number(base) || 0);
    if (lag) cost = Math.ceil(cost * (1 + ((lag.percent ?? 20) / 100)));
    if (overclock) cost = Math.floor(cost * (1 - ((overclock.percent ?? 20) / 100)));
    return Math.max(1, cost);
}

export function combatMethodLabel(method: string | undefined): string {
    if (method === "BURST" || method === "AOE_BURST" || method === "AOE_SPIRAL") return "Burst";
    if (method === "CIRCLE" || method === "AOE_CIRCLE" || method === "ALL") return "Circle";
    if (method === "INSTANT_EFFECT") return "Instant";
    return "Single";
}

export function combatTargetLabel(target: string | undefined): string {
    if (target === "SELF") return "Self";
    if (target === "EMPTY_GROUND") return "Ground";
    return "Enemy";
}
