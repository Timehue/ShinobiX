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
// same space as the sector markers.
//
// Each plate must read as ATTACHED to its landmark, so it is placed just clear
// of the icon's own anchor — the `icon:` note on each row below, which is the
// authoritative coordinate from the `locations` table in screens/WorldMap.tsx
// (plus SECTOR_POINTS 99 / 54 for Death's Gate and the Festival). Placement was
// re-derived 2026-07-30: the plates had drifted 14-26% BELOW their icons, which
// on the 16:9 board is 120-220px and reads as a caption for nothing.
//
// Owner direction 2026-07-30: EVERY plate sits DIRECTLY UNDER its icon (plate x
// == icon x), the way The Gates does — not off to one side. No exceptions.
//
// Several icons had a sector pin sitting almost exactly beneath them (pin 9
// under Ashen Leaf, 26 under Frostfang, 1 under Stormveil, 24 under Moonshadow,
// 64 below the obelisk, 54 above the Festival plate), so a plate tucked close
// could not avoid clipping one. Rather than push the plates back out, those six
// PINS were nudged 7-25px in shared/sector-links.ts — see the constraint list
// there; the derived exit directions are unchanged. Keep that in mind when
// editing either file: the two are now fitted against each other.
//
// Before moving one, re-measure: plate boxes are shrink-to-fit and the pins are
// a fixed 28px, so both the plate's %-footprint and the pin's grow as the board
// narrows. These offsets were fitted at 1660x860.
//
// The `tag` line is flavour drawn from the canon village paths in
// data/guides.ts; it is hidden on narrow screens (see world-map-charting.css)
// so phones get a clean name-only plate.
const POI_PLATES: ReadonlyArray<{ key: string; name: string; tag: string; x: number; y: number; tone?: string }> = [
    // icon (47, 8) — sector 99's skull, which renders at 36px rather than the
    // usual 28px, so this sits a little lower than the rest. Pin 60 was moved
    // right to open the column.
    { key: "deathsgate", name: "Death’s Gate", tag: "Endless ash — only the strongest walk in", x: 47, y: 12.5, tone: "ember" },
    // icon (16, 20) — pin 9 was moved out from under this crest
    { key: "ashenleaf", name: "Ashen Leaf Village", tag: "The Traditional Path — discipline and the old ways", x: 16, y: 26, tone: "leaf" },
    // icon (76, 20) — pin 26 was moved down off this plate
    { key: "frostfang", name: "Frostfang Village", tag: "The Loyal Path — forged in ice, bound by unity", x: 76, y: 26, tone: "frost" },
    // icon (48, 40) — the one that always fitted: the band between pins 47 / 48
    { key: "gates", name: "The Gates", tag: "The neutral hub, where every road converges", x: 48, y: 45.8, tone: "gold" },
    // icon (16, 74) — pin 1 was moved down off this plate
    { key: "stormveil", name: "Stormveil Village", tag: "The Chaotic Path — a lawless proving ground", x: 16, y: 79.8, tone: "tide" },
    // icon (63, 65) — pin 64 was moved down; pin 56 clears the plate's left edge.
    // Threads a 3.9% band: the obelisk is the tallest crest (74px) and pin 64 is
    // just below, so this y has under 1% of slack at either end.
    { key: "hollowgate", name: "Hollow Gate", tag: "A sealed obelisk between worlds", x: 63, y: 71.3, tone: "violet" },
    // icon (86, 64) — pin 24 was moved up off this plate
    { key: "moonshadow", name: "Moonshadow Village", tag: "The Selfish Path — stealth, secrets and deception", x: 86, y: 71, tone: "violet" },
    // icon (47, 84.5) — sector 54's marker, which was nudged up off this plate
    { key: "sunscar", name: "Sunscar Festival", tag: "A rest stop for weary travellers", x: 47, y: 89, tone: "sand" },
];

export function WorldPoiPlates() {
    return (
        <>
            {POI_PLATES.map((plate) => (
                <span
                    key={plate.key}
                    // `wpk-<key>` is the per-place hook the small-board layout in
                    // world-map-charting.css needs to re-anchor an individual
                    // plate; `wpp-<tone>` is the shared colour accent.
                    className={`world-poi-plate wpk-${plate.key}` + (plate.tone ? ` wpp-${plate.tone}` : "")}
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
