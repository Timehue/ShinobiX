/** Small formation contract shared by the offline ladder and its setup UI.
 * Keep this module independent of the combat/Three.js bundles. */
export const WARFRONT_LADDER_DEPLOYMENT = Object.freeze([3, 4, 7, 8]);
/** Reject old clients that would render a ranked Rite as the retired lane game. */
export const WARFRONT_LADDER_RULES = "beastbound-rite-v1";
export const WARFRONT_LADDER_CELLS = Object.freeze(Array.from({ length: 10 }, (_, id) => ({
    id,
    rank: id % 2 === 0 ? "Back" : "Front",
    file: Math.floor(id / 2) + 1,
})));

export type WarfrontLadderPlan = {
    formation: number[];
    deployment: number[];
    reformAfterClash: null;
    reforms: [];
};

export function defaultWarfrontLadderPlan(): WarfrontLadderPlan {
    return { formation: [0, 1, 2, 3], deployment: [...WARFRONT_LADDER_DEPLOYMENT], reformAfterClash: null, reforms: [] };
}

/** Ranked defenses commit opening positions and hold them for every clash.
 * Reject invalid/overlapping cells and future decisions instead of silently
 * scoring something different from the setup the player submitted. */
export function parseWarfrontLadderPlan(value: unknown): WarfrontLadderPlan | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const plan = value as Record<string, unknown>;
    const validNumbers = (v: unknown, max: number): v is number[] => Array.isArray(v)
        && v.length === 4 && new Set(v).size === 4
        && v.every((n) => Number.isInteger(n) && n >= 0 && n < max);
    if (!validNumbers(plan.formation, 4) || !validNumbers(plan.deployment, 10)
        || plan.reformAfterClash !== null
        || (plan.reforms !== undefined && (!Array.isArray(plan.reforms) || plan.reforms.length !== 0))
        || plan.reform != null || plan.reformDeployment != null) return null;
    return { formation: [...plan.formation], deployment: [...plan.deployment], reformAfterClash: null, reforms: [] };
}

/** Moving onto a teammate swaps cells, so every intermediate setup is legal. */
export function moveWarfrontLadderPet(plan: WarfrontLadderPlan, slot: number, node: number): WarfrontLadderPlan {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 4 || !Number.isInteger(node) || node < 0 || node >= 10) return plan;
    const deployment = [...plan.deployment];
    const occupied = deployment.indexOf(node);
    if (occupied >= 0) deployment[occupied] = deployment[slot];
    deployment[slot] = node;
    return { ...plan, deployment };
}
