/** Server-sealed score attacks keep health stable and accumulate post-shield
 * damage separately. Ordinary fighters retain their existing finite health. */
export type CombatHealth = { hp: number; unlimitedHealth?: boolean; damageReceived?: number };

export function damageCombatHealth<T extends CombatHealth>(fighter: T, amount: number): T {
    const damage = Math.max(0, Number(amount) || 0);
    return fighter.unlimitedHealth
        ? { ...fighter, damageReceived: (fighter.damageReceived ?? 0) + damage }
        : { ...fighter, hp: Math.max(0, fighter.hp - damage) };
}
