export type LoadedVital = {
    current: number;
    maximum: number;
};

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalize a persisted vital without turning a derived-stat migration into a
 * free heal. Level-up rewards refill explicitly in the progression engine;
 * merely loading an older save must preserve its authoritative current value.
 */
export function normalizeLoadedVital(
    current: unknown,
    storedMaximum: unknown,
    expectedMaximum: number,
): LoadedVital {
    const safeExpected = Math.max(1, Math.floor(finiteOr(expectedMaximum, 1)));
    const maximum = Math.max(safeExpected, Math.floor(finiteOr(storedMaximum, safeExpected)));
    const normalizedCurrent = Math.floor(finiteOr(current, safeExpected));
    return {
        current: Math.max(0, Math.min(maximum, normalizedCurrent)),
        maximum,
    };
}
