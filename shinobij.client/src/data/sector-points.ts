import { SECTOR_POINTS, type SectorPoint } from "../../../shared/sector-links";

/**
 * Atlas-only projection coordinates. Gameplay geography remains in the shared
 * sector graph; presentation nudges belong here so clearing a landmark cannot
 * silently change travel entry tiles or roaming-boss routes.
 */
export const ATLAS_SECTOR_POINTS: readonly SectorPoint[] = SECTOR_POINTS.map((point) =>
    point.id === 8 ? { ...point, x: 12 }
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
