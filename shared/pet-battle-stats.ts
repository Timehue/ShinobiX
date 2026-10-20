/** Derived combat channels. Growth still uses the four owned attributes. */
export const PET_ROLE_SPECIAL_LEAN: Readonly<Record<string, { atk: number; def: number }>> = Object.freeze({
    sage: { atk: 1.16, def: 1.08 }, assassin: { atk: .94, def: .94 },
    tracker: { atk: .96, def: 1 }, defender: { atk: 1, def: 1.02 },
});

export function petBattleChannels(input: { attack: number; defense: number; role?: string }) {
    const lean = Object.hasOwn(PET_ROLE_SPECIAL_LEAN, String(input.role)) ? PET_ROLE_SPECIAL_LEAN[String(input.role)] : PET_ROLE_SPECIAL_LEAN.defender;
    return {
        spAttack: Math.max(1, Math.round(input.attack * lean.atk)),
        spDefense: Math.max(1, Math.round(input.defense * lean.def)),
    };
}

/** Visible role endurance with a small, bounded Guard contribution. HP and
 * speed do not secretly increase the resource pool. */
export function petBattleStamina(input: { role?: string; level?: number; growthAllocation?: { guard?: number } }) {
    const pools: Record<string, number> = { sage: 76, assassin: 70, tracker: 74, defender: 80 };
    const base = Object.hasOwn(pools, String(input.role)) ? pools[String(input.role)] : 76;
    const level = Math.max(1, Math.min(100, Math.floor(Number(input.level) || 1)));
    const guard = Math.max(0, Math.min(Math.ceil((level - 1) / 2), Number(input.growthAllocation?.guard) || 0));
    return base + Math.round(Math.min(6, guard * .12));
}
