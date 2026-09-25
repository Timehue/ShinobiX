/** Canonical persisted Academy Path steps, shared by runtime and telemetry. */
export const ACADEMY_PATH_STEPS = [
    'academyIntro', 'starter', 'companionIntro', 'training', 'jutsu', 'jutsuLoadout',
    'inventory', 'academySpar', 'cafeteria', 'firstMission', 'logbook', 'sectorReturn', 'done',
] as const;

export type AcademyPathStep = typeof ACADEMY_PATH_STEPS[number];
