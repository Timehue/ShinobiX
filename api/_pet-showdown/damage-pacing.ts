/** Low-level pets need a response to a single technique. Keep ordinary hits
 * unchanged, then smoothly compress the excess above 60% of the target's max
 * health toward 90%. This is based on max HP, so wounded pets can still be
 * finished and stronger attacks never deal less damage than weaker ones.
 * Full effect through level 25; fades out by level 50. Taking the higher level
 * preserves earned level advantages. Ultimates retain the response window at
 * every level, with a stronger untouched band through 70% of max HP: their
 * first cast is now available early in an ordinary fight.
 * Applies equally to both teams, before Guard and damage absorption. */
export function paceShowdownTechniqueDamage(damage: number, maxHp: number, attackerLevel: number, defenderLevel: number, ultimate = false): number {
    const strength = ultimate ? 1 : 1 - Math.max(0, Math.min(1, (Math.max(attackerLevel, defenderLevel) - 25) / 25));
    const threshold = maxHp * (ultimate ? 0.7 : 0.6);
    if (strength <= 0 || damage <= threshold || maxHp <= 0) return damage;
    const room = maxHp * (ultimate ? 0.2 : 0.3);
    const excess = damage - threshold;
    const paced = threshold + room * excess / (room + excess);
    return damage + (paced - damage) * strength;
}
