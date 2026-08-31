/**
 * Save-safe vocabulary for Tamer Tomoe's pet-battle curriculum.
 * Dependency-free so both the client and save sanitizer use the same version,
 * identifiers, bounds, and normalization rules.
 */
export const PET_TUTORIAL_VERSION = 1;

export const PET_TUTORIAL_LESSON_IDS = [
    "bond",
    "showdown",
    "colosseum",
    "party",
    "ladder",
    "warfront",
    "gauntlet",
] as const;

export type PetTutorialLessonId = typeof PET_TUTORIAL_LESSON_IDS[number];

export type PetTutorialProgress = {
    version: number;
    completedLessonIds: PetTutorialLessonId[];
};

/** Lightweight unlock schedule used by the world-map wanderer without pulling
 * the full illustrated lesson copy into the map bundle. */
export const PET_TUTORIAL_UNLOCKS: ReadonlyArray<{
    id: PetTutorialLessonId;
    minLevel: number;
    minPets: number;
    shortTitle: string;
}> = [
    { id: "bond", minLevel: 2, minPets: 1, shortTitle: "Your companion" },
    { id: "showdown", minLevel: 5, minPets: 1, shortTitle: "Showdown" },
    { id: "colosseum", minLevel: 10, minPets: 1, shortTitle: "Colosseum" },
    { id: "party", minLevel: 15, minPets: 2, shortTitle: "2v2 teams" },
    { id: "ladder", minLevel: 20, minPets: 1, shortTitle: "Pet Ladder" },
    { id: "warfront", minLevel: 30, minPets: 4, shortTitle: "Warfront" },
    { id: "gauntlet", minLevel: 40, minPets: 1, shortTitle: "Gauntlet" },
];

const PET_TUTORIAL_LESSON_ID_SET = new Set<string>(PET_TUTORIAL_LESSON_IDS);

export function normalizePetTutorialProgress(value: unknown): PetTutorialProgress {
    const raw = value && typeof value === "object" && !Array.isArray(value)
        ? value as Partial<PetTutorialProgress>
        : {};
    const completed = Array.isArray(raw.completedLessonIds)
        ? raw.completedLessonIds.filter((id): id is PetTutorialLessonId => typeof id === "string" && PET_TUTORIAL_LESSON_ID_SET.has(id))
        : [];
    return {
        version: PET_TUTORIAL_VERSION,
        completedLessonIds: [...new Set(completed)].slice(0, PET_TUTORIAL_LESSON_IDS.length),
    };
}
