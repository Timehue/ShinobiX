import { MAX_STAT } from "../constants/game";

// Player-facing projection of the canonical combat formulas in
// api/combat-core/formulas.ts. These constants are parity-pinned there and in
// api/_combat-formula-parity.test.ts; this leaf helper keeps tooltip code from
// importing combat-math.ts, whose legacy App dependency is not test-safe.
export const STAT_POTENCY_SOFT_CAP = 0.5;
export const DISCIPLINE_POTENCY_SCALE = 2;

function pooledPotencyFraction(percent: number): number {
    const raw = Math.max(0, Number(percent) || 0) / 100;
    return raw > 0 ? raw / (raw + STAT_POTENCY_SOFT_CAP) : 0;
}

/** Flat bonus to each general stat when this is the only active stack. */
export function loneGeneralBonusFromPotency(percent: number): number {
    return Math.floor(pooledPotencyFraction(percent) * MAX_STAT);
}

/** Flat bonus to one discipline offense field when this is the only active stack. */
export function loneDisciplineBonusFromPotency(percent: number): number {
    return Math.floor(pooledPotencyFraction(percent) * MAX_STAT * DISCIPLINE_POTENCY_SCALE);
}
