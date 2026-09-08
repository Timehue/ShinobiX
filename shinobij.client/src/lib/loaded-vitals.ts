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
 * Seconds an EMPTY pool takes to refill by idle recovery alone, at any level.
 * MIRROR of REGEN_FULL_BAR_SEC in api/_elapsed-state.ts — the server settles the
 * authoritative value and its autosave ceiling allows exactly this rate, so a
 * divergence here shows up as the bar ticking up locally and then snapping back
 * on the next save.
 */
export const REGEN_FULL_BAR_SEC = 1800;

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
    // `rawAmount` is the caller's flat per-tick rate, historically `1 + auraRegen`
    // (App.tsx). The base 1 is now replaced by a per-pool share, so the AURA part
    // is what carries over — recover it as rawAmount - 1 and add it on top, which
    // reproduces the server's `max(1, ceil(max / REGEN_FULL_BAR_SEC)) + auraBonus`
    // exactly. A caller passing 1 (no aura) gets the pure pooled rate.
    const flat = Math.floor(finiteOr(rawAmount, 0));
    if (flat <= 0) return vitals;
    const bonus = Math.max(0, flat - 1);
    const step = (max: number) => Math.max(1, Math.ceil(Math.max(0, Math.floor(finiteOr(max, 0))) / REGEN_FULL_BAR_SEC)) + bonus;
    const hp = Math.min(vitals.maxHp, vitals.hp + step(vitals.maxHp));
    const chakra = Math.min(vitals.maxChakra, vitals.chakra + step(vitals.maxChakra));
    const stamina = Math.min(vitals.maxStamina, vitals.stamina + step(vitals.maxStamina));
    if (hp === vitals.hp && chakra === vitals.chakra && stamina === vitals.stamina) return vitals;
    return { ...vitals, hp, chakra, stamina };
}

/** The three vitals a tick raises, paired with the field that caps each. */
const IDLE_REGEN_VITALS: ReadonlyArray<readonly [string, string]> = [
    ["hp", "maxHp"],
    ["chakra", "maxChakra"],
    ["stamina", "maxStamina"],
];

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/**
 * True when `next` differs from `prev` ONLY by one idle-regeneration tick.
 *
 * `regenerateIdleVitals` promises above that a tick must not make an admitted
 * character dirty, but the promise is kept HERE: App detects local changes by
 * reference inequality, and a tick returns a fresh object every second while the
 * player is below full vitals. Treating that as a real change made a merely-OPEN
 * tab autosave forever with no player input — which is what turns two tabs into a
 * permanent 409 exchange, since both keep writing and each rejects the other. It
 * also put a pointless autosave on every damaged player, which is most of them
 * after a fight.
 *
 * Skipping the write loses nothing: the server re-derives regen from `_saveAt` on
 * every read (`api/_elapsed-state.ts`), the same reason a projection-only settle
 * no longer publishes a save version. App's caller never CLEARS the dirty flag on
 * a tick, so a real change that already set it still saves.
 *
 * ⛔ Matching "some vital went up" is NOT enough, and that mistake would silently
 * eat real progress. A tick raises EVERY un-capped vital by the SAME amount,
 * because it adds one figure to all three and clamps each at its max. A grant
 * that lifts one vital while another sits below its own max untouched is
 * therefore NOT a tick — that is the sector Recover button
 * (`WorldMap.restInSector`, stamina only) and the Story boss `recover()` action
 * (hp + chakra only), both client-owned grants with no server endpoint to
 * re-derive them. They must autosave, so they must not look like regen.
 */
export function isIdleVitalsOnlyChange(prev: unknown, next: unknown): boolean {
    if (prev === next) return false;
    const before = asRecord(prev);
    const after = asRecord(next);
    if (!before || !after) return false;

    const afterKeys = Object.keys(after);
    if (afterKeys.length !== Object.keys(before).length) return false;
    for (const key of afterKeys) {
        if (!Object.prototype.hasOwnProperty.call(before, key)) return false;
        if (Object.is(before[key], after[key])) continue;
        // Only a vital may differ; maxHp/maxChakra/maxStamina moving is a
        // derived-stat change, which is real progress.
        if (!IDLE_REGEN_VITALS.some(([vital]) => vital === key)) return false;
    }

    // A tick raises each un-capped vital by ITS OWN pooled step (a share of that
    // vital's maximum) plus the same flat Aura bonus on all three. Since the
    // pools differ by vital at most levels, the three rises are NOT equal — so
    // this checks that every rise is explained by one consistent Aura bonus,
    // rather than that they all match. Requiring equality here would mark every
    // tick dirty at any level where the pools diverge, which is the autosave
    // storm (and 409 exchange) this whole function exists to prevent.
    let bonus: number | null = null;
    let rose = false;
    for (const [vital, maxField] of IDLE_REGEN_VITALS) {
        const from = before[vital];
        const to = after[vital];
        if (typeof from !== "number" || typeof to !== "number") return false;
        if (to < from) return false; // a spend, a hit, or a KO — never regen
        const max = after[maxField];
        const capped = typeof max === "number" && Number.isFinite(max) && to === max;
        if (to === from) {
            // No rise is only a tick if this vital was already full. An
            // unverifiable maximum fails closed — the save still runs.
            if (!capped) return false;
            continue;
        }
        rose = true;
        // A vital clamped AT its maximum this tick rose by less than its step, so
        // it cannot pin the bonus; accept it and let the others do that.
        if (capped) continue;
        if (typeof max !== "number" || !Number.isFinite(max)) return false;
        const step = Math.max(1, Math.ceil(Math.max(0, Math.floor(max)) / REGEN_FULL_BAR_SEC));
        const implied = to - from - step;
        if (implied < 0) return false;                 // rose less than one tick — a grant, not regen
        if (bonus === null) bonus = implied;
        else if (bonus !== implied) return false;      // inconsistent across vitals — a grant
    }
    return rose;
}
