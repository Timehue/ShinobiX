import { starterBloodlineOffense } from "../data/jutsu";
import type { Stats } from "../types/combat";
import type { JutsuType } from "../types/core";

export type CombatDiscipline = Exclude<JutsuType, "Any">;

type LensCharacter = {
    bloodline: string;
    specialty: JutsuType;
    stats: Stats;
    equippedJutsuIds: string[];
};

type LensJutsu = {
    id: string;
    type: JutsuType;
    ap: number;
};

const DISCIPLINES: CombatDiscipline[] = ["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu"];

const OFFENSE_STAT: Record<CombatDiscipline, keyof Stats> = {
    Ninjutsu: "ninjutsuOffense",
    Taijutsu: "taijutsuOffense",
    Genjutsu: "genjutsuOffense",
    Bukijutsu: "bukijutsuOffense",
};

function isCombatDiscipline(value: JutsuType | undefined): value is CombatDiscipline {
    return Boolean(value && value !== "Any");
}

function characterFallback(character: LensCharacter): CombatDiscipline {
    const bloodlineDiscipline = starterBloodlineOffense[character.bloodline];
    if (isCombatDiscipline(bloodlineDiscipline)) return bloodlineDiscipline;
    return isCombatDiscipline(character.specialty) ? character.specialty : "Ninjutsu";
}

function highestOffense(
    character: LensCharacter,
    candidates: CombatDiscipline[],
): CombatDiscipline {
    const fallback = characterFallback(character);
    const highest = Math.max(...candidates.map((discipline) => {
        const value = character.stats[OFFENSE_STAT[discipline]];
        return Number.isFinite(value) ? value : 0;
    }));
    const tied = candidates.filter((discipline) => {
        const value = character.stats[OFFENSE_STAT[discipline]];
        return (Number.isFinite(value) ? value : 0) === highest;
    });
    return tied.includes(fallback) ? fallback : tied[0] ?? fallback;
}

/**
 * Picks the display discipline for damage-based effect copy.
 *
 * Equipped 60 AP jutsu are the strongest signal because they are the loadout's
 * offensive actions. A mixed-loadout tie is resolved by the character's raw
 * offense stats, then by their bloodline/specialty identity.
 */
export function resolveLoadoutLensDiscipline(
    character: LensCharacter,
    learnedJutsus: LensJutsu[],
): CombatDiscipline {
    const learnedById = new Map(learnedJutsus.map((jutsu) => [jutsu.id, jutsu]));
    const counts = new Map<CombatDiscipline, number>();

    for (const id of character.equippedJutsuIds) {
        const jutsu = learnedById.get(id);
        if (!jutsu || jutsu.ap !== 60 || !isCombatDiscipline(jutsu.type)) continue;
        counts.set(jutsu.type, (counts.get(jutsu.type) ?? 0) + 1);
    }

    const largestCount = Math.max(0, ...counts.values());
    const dominantLoadoutDisciplines = DISCIPLINES.filter(
        (discipline) => counts.get(discipline) === largestCount && largestCount > 0,
    );

    return highestOffense(
        character,
        dominantLoadoutDisciplines.length ? dominantLoadoutDisciplines : DISCIPLINES,
    );
}
