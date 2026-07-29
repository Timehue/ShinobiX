/**
 * Hollow Gate run-shape contract shared by the browser and API.
 *
 * A standard dive is deliberately five floors. Event variants may shorten a
 * dive, but no client/admin value may widen the server payout or encounter
 * envelope beyond this constant.
 */
export const HOLLOW_GATE_DEPTH = 5;
export const HOLLOW_GATE_MIN_DEPTH = 1;

export function canonicalHollowGateDepth(value?: unknown): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return HOLLOW_GATE_DEPTH;
    return Math.max(HOLLOW_GATE_MIN_DEPTH, Math.min(HOLLOW_GATE_DEPTH, parsed));
}
