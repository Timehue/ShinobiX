export type CafeteriaMealId = 'small-ramen' | 'shinobi-meal' | 'feast';

export type CafeteriaMeal = {
    id: CafeteriaMealId;
    name: string;
    cost: number;
    // Flat floors — the pre-2026-07-31 values, kept so a low-level player never
    // restores less than before the percent retune.
    hp: number;
    chakra: number;
    stamina: number;
    // Percent-of-max restore (owner ruling 2026-07-31): the old flats were
    // tuned for ~100-HP pools and became dead options against the
    // combatResourcesV2 ~10k pools (25 HP ramen). Each bar restores
    // max(flat, floor(maxPool × pct/100)). Feast keeps its full-restore flats.
    hpPct?: number;
    chakraPct?: number;
    staminaPct?: number;
};

export const CAFETERIA_MEALS: Record<CafeteriaMealId, CafeteriaMeal> = {
    'small-ramen': { id: 'small-ramen', name: 'Small Ramen', cost: 20, hp: 25, chakra: 10, stamina: 10, hpPct: 10, chakraPct: 5, staminaPct: 5 },
    'shinobi-meal': { id: 'shinobi-meal', name: 'Shinobi Meal', cost: 50, hp: 75, chakra: 35, stamina: 35, hpPct: 25, chakraPct: 15, staminaPct: 15 },
    feast: { id: 'feast', name: 'Feast', cost: 100, hp: 9999, chakra: 9999, stamina: 9999 },
};

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function restoreAmount(flat: number, pct: number | undefined, maxPool: number): number {
    const fromPct = pct ? Math.floor(maxPool * (pct / 100)) : 0;
    return Math.max(flat, fromPct);
}

export function cafeteriaMeal(id: unknown): CafeteriaMeal | null {
    const key = String(id ?? '') as CafeteriaMealId;
    return CAFETERIA_MEALS[key] ?? null;
}

export function applyCafeteriaMeal(
    character: Record<string, unknown>,
    meal: CafeteriaMeal,
): { ok: true; character: Record<string, unknown> } | { ok: false; error: string } {
    const ryo = num(character.ryo);
    if (ryo < meal.cost) return { ok: false, error: `Not enough ryo. ${meal.name} costs ${meal.cost}.` };

    const maxHp = num(character.maxHp);
    const maxChakra = num(character.maxChakra);
    const maxStamina = num(character.maxStamina);
    return {
        ok: true,
        character: {
            ...character,
            ryo: ryo - meal.cost,
            hp: Math.min(maxHp, num(character.hp) + restoreAmount(meal.hp, meal.hpPct, maxHp)),
            chakra: Math.min(maxChakra, num(character.chakra) + restoreAmount(meal.chakra, meal.chakraPct, maxChakra)),
            stamina: Math.min(maxStamina, num(character.stamina) + restoreAmount(meal.stamina, meal.staminaPct, maxStamina)),
        },
    };
}
