/*
 * Client mirror of api/_war-map-sectors.ts HOME_SECTORS — which of the 4 war
 * villages owns each of the 32 home sectors (the static political map). Kept in
 * sync manually with the server table. The world-map ownership treatment reads
 * this so a village's sectors VISIBLY read as that village's, without depending on
 * the server war feature being enabled (captures override via the territory cache).
 */
export const HOME_SECTORS: Record<string, readonly number[]> = {
    "Moonshadow Village": [11, 19, 15, 4, 5, 6, 16, 8],
    "Stormveil Village": [31, 21, 22, 34, 24, 32, 26, 27],
    "Ashen Leaf Village": [38, 36, 37, 39, 40, 41, 42, 43],
    "Frostfang Village": [47, 46, 48, 49, 50, 51, 53, 54],
};

const SECTOR_TO_VILLAGE: Record<number, string> = (() => {
    const m: Record<number, string> = {};
    for (const [village, sectors] of Object.entries(HOME_SECTORS)) {
        for (const s of sectors) m[s] = village;
    }
    return m;
})();

/** The village that owns `sector` by default (undefined for neutral / central /
 *  special sectors). A captured sector's live owner comes from the territory cache. */
export function homeVillageForSector(sector: number): string | undefined {
    return SECTOR_TO_VILLAGE[sector];
}
