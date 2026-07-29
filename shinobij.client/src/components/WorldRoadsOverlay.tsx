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
// Only the regions that DON'T already carry a POI plaque get a region label —
// otherwise the map double-captions itself. The Castle City is named by "The
// Gates", the Festival Grounds by "Sunscar Festival", the Hollow Road by
// "Hollow Gate" and the Lavafront by "Death's Gate", so the two connective
// regions with no landmark of their own are all that remain. Placed on open
// ground in the 2026-07 keyart, clear of the sector pins.
const REGION_LABEL_POINTS: ReadonlyArray<{ key: SectorRegionKey; x: number; y: number }> = [
    { key: "frostborder", x: 65, y: 41 },
    { key: "midlands", x: 25, y: 44 },
];

// Name plaques for the eight headline places on the world keyart. The painting
// deliberately carries no lettering, so these are load-bearing (not flag-gated)
// — they are how a player reads the world. Positions are %-coordinates in the
// same space as the sector markers, hand-placed just below each landmark so the
// plate labels its feature without covering it.
//
// The `tag` line is flavour drawn from the canon village paths in
// data/guides.ts; it is hidden on narrow screens (see world-map-charting.css)
// so phones get a clean name-only plate.
const POI_PLATES: ReadonlyArray<{ key: string; name: string; tag: string; x: number; y: number; tone?: string }> = [
    { key: "deathsgate", name: "Death’s Gate", tag: "Endless ash — only the strongest walk in", x: 39, y: 9, tone: "ember" },
    { key: "ashenleaf", name: "Ashen Leaf Village", tag: "The Traditional Path — discipline and the old ways", x: 14, y: 38, tone: "leaf" },
    { key: "frostfang", name: "Frostfang Village", tag: "The Loyal Path — forged in ice, bound by unity", x: 79, y: 36, tone: "frost" },
    { key: "gates", name: "The Gates", tag: "The neutral hub, where every road converges", x: 53, y: 66, tone: "gold" },
    { key: "stormveil", name: "Stormveil Village", tag: "The Chaotic Path — a lawless proving ground", x: 18, y: 89, tone: "tide" },
    { key: "hollowgate", name: "Hollow Gate", tag: "A sealed obelisk between worlds", x: 63, y: 79, tone: "violet" },
    { key: "moonshadow", name: "Moonshadow Village", tag: "The Selfish Path — stealth, secrets and deception", x: 84, y: 87, tone: "violet" },
    { key: "sunscar", name: "Sunscar Festival", tag: "A rest stop for weary travellers", x: 40, y: 92, tone: "sand" },
];

export function WorldPoiPlates() {
    return (
        <>
            {POI_PLATES.map((plate) => (
                <span
                    key={plate.key}
                    className={"world-poi-plate" + (plate.tone ? ` wpp-${plate.tone}` : "")}
                    style={{ left: `${plate.x}%`, top: `${plate.y}%` }}
                    aria-hidden="true"
                >
                    <span className="world-poi-plate-name">{plate.name}</span>
                    <span className="world-poi-plate-tag">{plate.tag}</span>
                </span>
            ))}
        </>
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
