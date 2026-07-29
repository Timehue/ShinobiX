/*
 * WorldRoadsOverlay — charts the road graph + region names over the painted
 * world map, so the (previously invisible) sector connectivity reads at a
 * glance. Pure presentation: pointer-events none, sits below the z-10 sector
 * markers, rides the same %-coordinate space (and mobile-zoom transform) as
 * the markers. Flag `worldRoads.v1` default ON; "off" is the kill switch.
 *
 * Styles live in world-map-charting.css, imported by the WorldMap SCREEN
 * (components must not import CSS — it breaks the node test runner).
 */
import { SECTOR_POINTS, SECTOR_ROAD_PAIRS } from "../../../shared/sector-links";
import { SECTOR_REGION_LABELS, type SectorRegionKey } from "../../../shared/sector-geo";

export function isWorldRoadsEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("worldRoads.v1") !== "off"; } catch { return true; }
}

const POINT_BY_ID = new Map(SECTOR_POINTS.map((p) => [p.id, p]));

/** Gentle quadratic bow so roads read as trails, not survey lines. */
function roadPath(a: number, b: number): string {
    const pa = POINT_BY_ID.get(a);
    const pb = POINT_BY_ID.get(b);
    if (!pa || !pb) return "";
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(1.6, len * 0.14);
    return `M ${pa.x} ${pa.y} Q ${(mx - (dy / len) * bow).toFixed(2)} ${(my + (dx / len) * bow).toFixed(2)} ${pb.x} ${pb.y}`;
}

const ROADS = SECTOR_ROAD_PAIRS
    .map(([a, b]) => ({ id: `${a}-${b}`, d: roadPath(a, b) }))
    .filter((road) => road.d !== "");

// Name plates for the connective regions. The four village homelands keep
// their painted banners and Death's Gate its skull marker, so labeling them
// again would double-caption the map. Hand-placed against the keyart.
const REGION_LABEL_POINTS: ReadonlyArray<{ key: SectorRegionKey; x: number; y: number }> = [
    { key: "frostborder", x: 71, y: 40 },
    { key: "midlands", x: 34, y: 57 },
    { key: "castle", x: 51, y: 52 },
    { key: "festival", x: 48, y: 87 },
    { key: "hollowroad", x: 58, y: 77 },
    { key: "lavafront", x: 57, y: 30 },
];

// Village name plates over the bare banner boards baked into the 2026-07
// keyart (the painting carries no text). Rendered in the art's own 1536x1024
// pixel space so the lettering sits exactly on its board and zooms/stretches
// in lockstep with the painting; textLength pins each name to the free run of
// board to the right of its crest landmark. Not flag-gated — with no baked
// text these names are load-bearing.
const VILLAGE_BANNER_PLATES: ReadonlyArray<{ name: string; x: number; y: number; length: number }> = [
    { name: "Ashen Leaf Village", x: 292, y: 385, length: 172 },
    { name: "Frostfang Village", x: 1311, y: 385, length: 156 },
    { name: "Stormveil Village", x: 291, y: 862, length: 170 },
    { name: "Moonshadow Village", x: 1277, y: 861, length: 176 },
];

export function WorldVillagePlates() {
    return (
        <svg className="world-village-plates-svg" viewBox="0 0 1536 1024" preserveAspectRatio="none" aria-hidden="true">
            {VILLAGE_BANNER_PLATES.map((plate) => (
                <text
                    key={plate.name}
                    className="world-village-plate"
                    x={plate.x}
                    y={plate.y}
                    textAnchor="middle"
                    textLength={plate.length}
                    lengthAdjust="spacingAndGlyphs"
                >
                    {plate.name}
                </text>
            ))}
        </svg>
    );
}

export function WorldRoadsOverlay() {
    if (!isWorldRoadsEnabled()) return null;
    return (
        <>
            <svg className="world-roads-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {ROADS.map((road) => (
                    <path key={road.id} d={road.d} className="world-road" vectorEffect="non-scaling-stroke" />
                ))}
            </svg>
            {REGION_LABEL_POINTS.map((entry) => (
                <span
                    key={entry.key}
                    className="world-region-label"
                    style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
                    aria-hidden="true"
                >
                    {SECTOR_REGION_LABELS[entry.key]}
                </span>
            ))}
        </>
    );
}
