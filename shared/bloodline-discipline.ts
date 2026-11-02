export type CombatDiscipline = 'Ninjutsu' | 'Taijutsu' | 'Genjutsu' | 'Bukijutsu';

type DisciplineJutsu = { type?: unknown; effectPower?: number; ap?: number; isUtility?: boolean };

export const isCombatDiscipline = (value: unknown): value is CombatDiscipline =>
    /^(Nin|Tai|Gen|Buki)jutsu$/.test(value as string);

/**
 * How many techniques of each discipline a bloodline carries. Damage techniques
 * decide it; a kit with none counts everything. "Any" utility never counts.
 * Saved kits are stored JSON, so a stray type must not reach a discipline lookup.
 */
export function bloodlineDisciplineCounts(bloodline: { jutsus: readonly DisciplineJutsu[] } | undefined): Map<CombatDiscipline, number> {
    const damageJutsus = bloodline?.jutsus.filter((j) => j.effectPower! > 0 && j.isUtility !== true
        && (j.isUtility === false || j.ap !== 40)) ?? [];
    const counts = new Map<CombatDiscipline, number>();
    for (const { type } of damageJutsus.length ? damageJutsus : bloodline?.jutsus ?? []) {
        if (isCombatDiscipline(type)) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
}

/** The most-used discipline; a tie goes to `preferred`, then alphabetically. */
export function leadingBloodlineDiscipline(counts: Map<CombatDiscipline, number>, preferred: unknown): CombatDiscipline | undefined {
    return [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!)
        || Number(b === preferred) - Number(a === preferred) || a.localeCompare(b))[0];
}
