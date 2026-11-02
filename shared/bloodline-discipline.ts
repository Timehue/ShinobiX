export type CombatDiscipline = 'Ninjutsu' | 'Taijutsu' | 'Genjutsu' | 'Bukijutsu';

const COMBAT_DISCIPLINES: readonly CombatDiscipline[] = ['Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu'];

type DisciplineJutsu = { type?: unknown; effectPower?: unknown; ap?: unknown; isUtility?: unknown };

export function isCombatDiscipline(value: unknown): value is CombatDiscipline {
    return COMBAT_DISCIPLINES.some((known) => known === value);
}

/**
 * How many techniques of each discipline a bloodline carries. Damage techniques
 * decide it; a kit with none counts everything. "Any" utility never counts.
 * Saved kits are stored JSON, so a stray type must not reach a discipline lookup.
 */
export function bloodlineDisciplineCounts(bloodline: { jutsus?: readonly DisciplineJutsu[] } | undefined): Map<CombatDiscipline, number> {
    const jutsus = Array.isArray(bloodline?.jutsus) ? bloodline.jutsus : [];
    const damageJutsus = jutsus.filter((j) => Number(j?.effectPower) > 0 && j.isUtility !== true
        && (j.isUtility === false || j.ap !== 40));
    const counts = new Map<CombatDiscipline, number>();
    for (const jutsu of damageJutsus.length ? damageJutsus : jutsus) {
        const discipline = jutsu?.type;
        if (isCombatDiscipline(discipline)) counts.set(discipline, (counts.get(discipline) ?? 0) + 1);
    }
    return counts;
}

/** The most-used discipline; a tie goes to `preferred`, then alphabetically. */
export function leadingBloodlineDiscipline(counts: Map<CombatDiscipline, number>, preferred: unknown): CombatDiscipline | undefined {
    return [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!)
        || Number(b === preferred) - Number(a === preferred) || a.localeCompare(b))[0];
}
