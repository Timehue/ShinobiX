import { SECTOR_POINTS, type SectorPoint } from "../../../shared/sector-links";

/**
 * Atlas-only projection coordinates. Gameplay geography remains in the shared
 * sector graph; presentation nudges belong here so clearing a landmark cannot
 * silently change travel entry tiles or roaming-boss routes.
 */
export const ATLAS_SECTOR_POINTS: readonly SectorPoint[] = SECTOR_POINTS.map((point) =>
    point.id === 8 ? { ...point, x: 12 } : point,
);
