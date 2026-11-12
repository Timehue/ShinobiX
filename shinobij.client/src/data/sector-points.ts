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
const CONE_NUDGES: Readonly<Record<number, { x: number; y: number }>> = {
    13: { x: 26.5, y: 13 },
    36: { x: 36, y: 30 },
    37: { x: 43, y: 30 },
    58: { x: 42, y: 22 },
    59: { x: 59.5, y: 31 },
    60: { x: 60, y: 23 },
    99: { x: 83, y: 42 },
};

/**
 * Atlas-only projection coordinates. Gameplay geography remains in the shared
 * sector graph; presentation nudges belong here so clearing a landmark cannot
 * silently change travel entry tiles or roaming-boss routes.
 */
export const ATLAS_SECTOR_POINTS: readonly SectorPoint[] = SECTOR_POINTS.map((point) =>
    CONE_NUDGES[point.id] ? { ...point, ...CONE_NUDGES[point.id] }
        : point.id === 8 ? { ...point, x: 12 }
        // The Hollow Gate crest sits between S55 and S57; the old S55 point
        // fell inside its large click target at common desktop widths.
        : point.id === 55 ? { ...point, x: 54, y: 57 }
        // Leave the central Moonshadow court and its caption open. These are
        // atlas nudges only; roads use this projection, travel uses the graph.
        : point.id === 17 ? { ...point, x: 86, y: 87 }
        : point.id === 23 ? { ...point, x: 74.5, y: 69 }
        : point.id === 24 ? { ...point, x: 94, y: 87 }
        : point.id === 25 ? { ...point, x: 73, y: 88 } : point,
);
