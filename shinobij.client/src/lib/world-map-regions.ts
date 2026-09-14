import { VIEWPORT_BREAKPOINTS } from "./viewport-contract";

/** Camera presets only: the painted atlas and gameplay coordinates are unchanged. */
export const WORLD_MAP_ASPECT_RATIO = 1672 / 941;

// Match the mobile game shell; touch input alone must not replace a desktop map.
export const WORLD_MAP_MOBILE_QUERY = `(max-width: ${VIEWPORT_BREAKPOINTS.md - 1}px)`;

export const WORLD_MAP_REGIONS = [
    { id: "ashen", label: "Ashen Leaf", position: "Top left", column: 0, row: 0 },
    { id: "gate", label: "Death's Gate", position: "Top center", column: 1, row: 0 },
    { id: "frost", label: "Frostfang", position: "Top right", column: 2, row: 0 },
    { id: "storm", label: "Stormveil", position: "Bottom left", column: 0, row: 1 },
    { id: "central", label: "Central", position: "Bottom center", column: 1, row: 1 },
    { id: "moon", label: "Moonshadow", position: "Bottom right", column: 2, row: 1 },
] as const;

export type WorldMapRegionId = typeof WORLD_MAP_REGIONS[number]["id"];
export type WorldMapViewSize = Readonly<{ w: number; h: number }>;
export type WorldMapRegionView = Readonly<{ zoom: number; tx: number; ty: number }>;

/** Six edge-aligned windows with enough overlap for a complete 44px hit target.
 * Short landscape stages reserve a gutter so pins near the world boundary
 * remain fully tappable even when the whole painting is relatively small. */
export function getWorldMapRegionView(size: WorldMapViewSize, regionId: WorldMapRegionId): WorldMapRegionView {
    const { w, h } = size;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return { zoom: 1, tx: 0, ty: 0 };
    }
    const region = WORLD_MAP_REGIONS.find((entry) => entry.id === regionId) ?? WORLD_MAP_REGIONS[0];
    const overlap = 56;
    const edge = Math.min(w, h) < 180 ? Math.min(24, w / 4, h / 4) : 0;
    const imageWidth = Math.max(1, Math.min(3 * w - 2 * overlap - 2 * edge, (2 * h - overlap - 2 * edge) * WORLD_MAP_ASPECT_RATIO));
    const imageHeight = imageWidth / WORLD_MAP_ASPECT_RATIO;
    return {
        zoom: imageWidth / w,
        tx: imageWidth <= w - 2 * edge ? (w - imageWidth) / 2 : edge - region.column * (imageWidth - w + 2 * edge) / 2,
        ty: imageHeight <= h - 2 * edge ? (h - imageHeight) / 2 : edge - region.row * (imageHeight - h + 2 * edge),
    };
}

/** The area containing a player/Academy destination, used on first opening. */
export function getWorldMapRegionForPoint(xPct: number, yPct: number): WorldMapRegionId {
    const x = Number.isFinite(xPct) ? xPct : 50;
    const y = Number.isFinite(yPct) ? yPct : 50;
    const column = Math.max(0, Math.min(2, Math.floor(x * 3 / 100)));
    const row = y < 50 ? 0 : 1;
    return WORLD_MAP_REGIONS.find((entry) => entry.column === column && entry.row === row)!.id;
}
