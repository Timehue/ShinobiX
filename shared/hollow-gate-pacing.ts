/** Shrine-only pacing. Existing manifests retain their sealed geometry/counts. */
export const HOLLOW_GATE_HUNTER_BREATHER_STEPS = 3;

export function hollowGateOrdinaryBattleCount(floor: number, legacy = false): number {
    return (legacy ? 4 : 3) + Math.min(5, floor);
}
