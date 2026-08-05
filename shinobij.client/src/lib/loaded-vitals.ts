export type LoadedVital = {
    current: number;
    maximum: number;
};

export type IdleRegeneratingVitals = {
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    hospitalized?: boolean;
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

/**
 * Apply one idle-regeneration tick without making an admitted character dirty.
 * Hospital discharge is server-authoritative; until it lands, HP must remain at
 * the KO value instead of climbing locally and being echoed by autosave.
 */
export function regenerateIdleVitals<T extends IdleRegeneratingVitals>(
    vitals: T,
    rawAmount: number,
): T {
    if (vitals.hospitalized) return vitals;
    const amount = Math.max(0, Math.floor(finiteOr(rawAmount, 0)));
    if (amount <= 0) return vitals;
    const hp = Math.min(vitals.maxHp, vitals.hp + amount);
    const chakra = Math.min(vitals.maxChakra, vitals.chakra + amount);
    const stamina = Math.min(vitals.maxStamina, vitals.stamina + amount);
    if (hp === vitals.hp && chakra === vitals.chakra && stamina === vitals.stamina) return vitals;
    return { ...vitals, hp, chakra, stamina };
}
