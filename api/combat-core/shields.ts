/** A shield protects its bearer during the grant round and the following round. */
export const SHIELD_DURATION_ROUNDS = 2;

export type TimedShield = {
    shield: number;
    shieldExpiresAtRound?: number;
};

export function shieldExpiryForGrant(round: number): number {
    return round + SHIELD_DURATION_ROUNDS;
}

/** Existing shield at battle creation starts in round one. */
export function timeStartingShield<T extends TimedShield>(fighter: T): T {
    return fighter.shield > 0 && fighter.shieldExpiresAtRound === undefined
        ? { ...fighter, shieldExpiresAtRound: shieldExpiryForGrant(1) }
        : fighter;
}

/** Refresh the whole remaining pool only when a grant actually adds shield. */
export function timeShieldGain<T extends TimedShield>(fighter: T, previousShield: number, round: number): T {
    return fighter.shield > previousShield
        ? { ...fighter, shieldExpiresAtRound: shieldExpiryForGrant(round) }
        : fighter;
}

/** Called at the boundary entering `nextRound`, before anyone acts in it. */
export function expireShield<T extends TimedShield>(fighter: T, nextRound: number): T {
    if (fighter.shield <= 0) return fighter;
    // Legacy live sessions had no timer; treat their shield as a round-one grant.
    if (nextRound < (fighter.shieldExpiresAtRound ?? shieldExpiryForGrant(1))) return fighter;
    return { ...fighter, shield: 0, shieldExpiresAtRound: undefined };
}
