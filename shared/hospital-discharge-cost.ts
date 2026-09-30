export const HOSPITAL_DISCHARGE_RYO_PER_LEVEL = 25;
export const HOSPITAL_DISCHARGE_RYO_CAP = 2_500;

/** Ryo charged to skip the free hospital timer, before existing discounts. */
export function hospitalDischargeBaseCost(level: unknown): number {
    const parsed = Math.floor(Number(level));
    const safeLevel = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
    return Math.min(HOSPITAL_DISCHARGE_RYO_CAP, safeLevel * HOSPITAL_DISCHARGE_RYO_PER_LEVEL);
}
