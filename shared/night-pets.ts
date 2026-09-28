/*
 * Night-only wild pets.
 *
 * These templates can be met in the wild only while the world is dark
 * (shared/world-phase isWorldNight, the same clock the sky and the night
 * ninjas use). Each was picked because its own description already says it
 * is a night creature. They can still be owned, bred and traded at any hour;
 * only the WILD encounter is gated.
 *
 * The gate changes WHICH pet of the already-rolled rarity appears, never the
 * hit/miss roll or the rarity odds (api/pet/_encounter.ts rollWildPet). At
 * night these pets are also twice as likely to be the one drawn, so a night
 * hunt feels like a night hunt.
 */
export const NIGHT_ONLY_WILD_PET_IDS: ReadonlySet<string> = new Set([
    'standard-10', // Pine Owl
    'standard-18', // Shadow Bat
    'standard-27', // Cinder Moth
    'rare-2',      // Night Panther
    'rare-10',     // Silver Owl
    'rare-18',     // Duskwings Bat
    'legendary-2', // Umbra Fox
    'legendary-7', // Moon Serpent
]);

/** Draw weight for a night pet while it is night (day pets weigh 1). */
export const NIGHT_PET_NIGHT_WEIGHT = 2;

export function isNightOnlyWildPet(templateId: string): boolean {
    return NIGHT_ONLY_WILD_PET_IDS.has(templateId);
}
