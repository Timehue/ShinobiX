/*
 * Client mirror of api/_war-map-sectors.ts HOME_SECTORS — which of the 4 war
 * villages owns each of the 32 home sectors (the static political map). Kept in
 * sync manually with the server table. The world-map ownership treatment reads
 * this so a village's sectors VISIBLY read as that village's, without depending on
 * the server war feature being enabled (captures override via the territory cache).
 */
// 2026-07 region-block numbering: each village's block starts at its own gate.
export const HOME_SECTORS: Record<string, readonly number[]> = {
    "Moonshadow Village": [17, 18, 19, 20, 21, 22, 23, 24],
    "Stormveil Village": [1, 2, 3, 4, 5, 6, 7, 8],
    "Ashen Leaf Village": [9, 10, 11, 12, 13, 14, 15, 16],
    "Frostfang Village": [26, 27, 28, 29, 30, 33, 31, 32],
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
