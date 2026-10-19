/** Preserve a response to one direct hit at every level. Ordinary techniques
 * keep their damage through 60% HP, then approach 90%. A signature approaches
 * 60% without setup, or 75% with Empower, Mark or a favorable field. Compression
 * stays strictly increasing; max HP keeps wounded-target finishing intact.
 * Both teams use the same curve, before Guard and damage absorption. Level
 * arguments remain for callers; progression still prices the incoming damage. */
export function paceShowdownTechniqueDamage(damage: number, maxHp: number, _attackerLevel: number, _defenderLevel: number, ultimate = false, prepared = false): number {
    const threshold = maxHp * (ultimate ? prepared ? 0.55 : 0.4 : 0.6);
    if (damage <= threshold || maxHp <= 0) return damage;
    const room = maxHp * (ultimate ? 0.2 : 0.3);
    const excess = damage - threshold;
    const paced = threshold + room * excess / (room + excess);
    return paced;
}

/** Persisted sessions and pre-cutover descriptors retain their original curve. */
export function paceLegacyShowdownTechniqueDamage(damage: number, maxHp: number, attackerLevel: number, defenderLevel: number, ultimate = false): number {
    const strength = ultimate ? 1 : 1 - Math.max(0, Math.min(1, (Math.max(attackerLevel, defenderLevel) - 25) / 25));
    const threshold = maxHp * (ultimate ? 0.7 : 0.6);
    if (strength <= 0 || damage <= threshold || maxHp <= 0) return damage;
    const room = maxHp * (ultimate ? 0.2 : 0.3);
    const excess = damage - threshold;
    const paced = threshold + room * excess / (room + excess);
    return damage + (paced - damage) * strength;
}

/** Extreme-hit safety for new progression entries. Ordinary reference hits
 * remain linear so Power and Guard retain their marginal value. */
export function paceProgressionTechniqueDamage(damage: number, maxHp: number, _attackerLevel: number, _defenderLevel: number, ultimate = false, prepared = false): number {
    const threshold = maxHp * (ultimate ? prepared ? .75 : .6 : .7);
    if (damage <= threshold || maxHp <= 0) return damage;
    const room = maxHp * (ultimate ? .2 : .25);
    const excess = damage - threshold;
    return threshold + room * excess / (room + excess);
}
