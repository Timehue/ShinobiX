import { SECTOR_POINTS, type SectorPoint } from "../../../shared/sector-links";

/**
 * Atlas presentation around Cinderhold's cone (2026-11-11, owner: "organize
 * these better", and put Death's Gate somewhere with open room). Cinderhold's
 * own sectors (67-74) sit at their real positions (shared/sector-links.ts),
 * which ring the crest. These older neighbours only step aside on the atlas,
 * each by a nudge that keeps every road leaving it on the side its floor paints
 * that exit (sector-points.test.ts checks this for every road). Death's Gate
 * (99), a map-travel arena with no roads, moves off the cone into the open
 * hills between Frostfang and Moonshadow.
 */
const ATLAS_NUDGES: Readonly<Record<number, readonly [x: number, y?: number]>> = {
    13: [26.5, 13], 36: [36, 30], 37: [43, 30], 58: [42, 22], 59: [59.5, 31], 60: [60, 23], 99: [83, 42],
    8: [12],
    // The Hollow Gate crest sits between S55 and S57; the old S55 point
    // fell inside its large click target at common desktop widths.
    55: [54, 57],
    // Leave the central Moonshadow court and its caption open.
    17: [86, 87], 23: [74.5, 69], 24: [94, 87], 25: [73, 88],
};

/**
 * Atlas-only projection coordinates. Gameplay geography remains in the shared
 * sector graph; presentation nudges belong here so clearing a landmark cannot
 * silently change travel entry tiles or roaming-boss routes. Roads use this
 * projection; travel uses the graph.
 */
export const ATLAS_SECTOR_POINTS: readonly SectorPoint[] = SECTOR_POINTS.map((point) => {
    const nudge = ATLAS_NUDGES[point.id];
    return nudge ? { ...point, x: nudge[0], y: nudge[1] ?? point.y } : point;
});
