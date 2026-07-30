/*
 * WorldWalkFeel — the threshold-moment layer for walking the world:
 *
 *   SectorGateMarker  painted-style torii gate on road-exit tiles (replaces the
 *                     arrow + "S23" chip), tinted by the DESTINATION region so
 *                     the doorway telegraphs where it leads.
 *   RegionSplash      Elden-Ring-style region-name calligraphy card, shown once
 *                     per region per session when the player enters it.
 *   RouteGlowOverlay  shortest walking route (BFS over the shared road graph)
 *                     glowed onto the world map while hovering a destination.
 *
 * Styles live in world-walk-feel.css, imported by the WorldMap SCREEN
 * (components must not import CSS — it breaks the node test runner).
 */
import { useEffect, useRef } from "react";
import { SECTOR_POINTS, SECTOR_ROAD_PAIRS, WALK_IN_DEPTH } from "../../../shared/sector-links";
import { sectorRegionKey, sectorRegionLabel, type SectorRegionKey } from "../../../shared/sector-geo";
import type { SectorDirection } from "../../../shared/sector-links";

/** Region accent tints (match the world-map treatment per region). */
const REGION_TINT: Readonly<Record<SectorRegionKey, string>> = {
    stormveil: "#3c96ab",
    ashenleaf: "#57a86a",
    moonshadow: "#b666c8",
    frostfang: "#6494dd",
    frostborder: "#79b8cc",
    midlands: "#a3b54a",
    castle: "#8a6fd1",
    festival: "#d1912f",
    hollowroad: "#9a76c9",
    lavafront: "#d9603b",
    deathsgate: "#d9603b",
};

export function regionTintForSector(sector: number): string {
    const key = sectorRegionKey(sector);
    return key ? REGION_TINT[key] : "#c9a45c";
}

/* ── Gate marker ─────────────────────────────────────────────────────────── */

/** Torii-silhouette gate on an exit tile, tinted by the destination region.
 *  `ready` = the player stands on the tile (one more step crosses). */
export function SectorGateMarker({ destinationSector, direction, ready }: {
    destinationSector: number;
    direction: SectorDirection;
    ready: boolean;
}) {
    const tint = regionTintForSector(destinationSector);
    return (
        <span className={`sector-gate ${ready ? "sector-gate-ready" : ""} sector-gate-${direction}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="sector-gate-svg" style={{ color: tint }}>
                {/* kasagi (top lintel, slight wing) */}
                <path d="M1.5 7.4 Q12 4.6 22.5 7.4 L22.5 9.2 Q12 6.6 1.5 9.2 Z" fill="currentColor" />
                {/* nuki (tie beam) */}
                <rect x="4.1" y="11" width="15.8" height="1.7" rx="0.5" fill="currentColor" />
                {/* pillars, slightly splayed */}
                <path d="M5.2 8.2 L7.6 8.2 L8.3 22 L5.6 22 Z" fill="currentColor" />
                <path d="M16.4 8.2 L18.8 8.2 L18.4 22 L15.7 22 Z" fill="currentColor" />
            </svg>
            <b className={`sector-gate-chevron is-${direction}`}>
                {direction === "north" ? "↑" : direction === "east" ? "→" : direction === "south" ? "↓" : "←"}
            </b>
        </span>
    );
}

/* ── Region splash ───────────────────────────────────────────────────────── */

const SPLASH_SESSION_PREFIX = "regionSplash.v1:";

/** The region label to splash for entering `sector`, once per region per
 *  session — or null when it has already been shown (or off-world). */
export function regionSplashLabelFor(sector: number): string | null {
    const key = sectorRegionKey(sector);
    if (!key) return null;
    try {
        const storageKey = `${SPLASH_SESSION_PREFIX}${key}`;
        if (sessionStorage.getItem(storageKey)) return null;
        sessionStorage.setItem(storageKey, "1");
    } catch {
        /* storage disabled — splash every time rather than never */
    }
    return sectorRegionLabel(sector) ?? null;
}

/** Calligraphy card announcing the region. Remounts per `stamp` so repeated
 *  splashes replay the animation; hides itself after it plays. */
export function RegionSplash({ label, tint, stamp, onDone }: {
    label: string;
    tint: string;
    stamp: number;
    onDone: () => void;
}) {
    // Latest-callback ref so a re-rendered (inline) onDone never re-arms the
    // hide timer — the splash always ends 2.4s after the stamp that showed it.
    const onDoneRef = useRef(onDone);
    useEffect(() => {
        onDoneRef.current = onDone;
    }, [onDone]);
    useEffect(() => {
        const timer = window.setTimeout(() => onDoneRef.current(), 2400);
        return () => window.clearTimeout(timer);
    }, [stamp]);
    return (
        <div className="region-splash" key={stamp} aria-hidden="true">
            <span className="region-splash-name" style={{ ["--splash-tint" as string]: tint }}>{label}</span>
        </div>
    );
}

/* ── Route glow ──────────────────────────────────────────────────────────── */

const POINT_BY_ID = new Map(SECTOR_POINTS.map((p) => [p.id, p]));
const NEIGHBORS = (() => {
    const m = new Map<number, number[]>();
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        m.set(a, [...(m.get(a) ?? []), b]);
        m.set(b, [...(m.get(b) ?? []), a]);
    }
    return m;
})();

/** Shortest road route (sector ids, inclusive) or null when unreachable /
 *  either end is off the road graph (village 0, Death's Gate 99). */
export function walkingRoute(from: number, to: number): number[] | null {
    if (!NEIGHBORS.has(from) || !NEIGHBORS.has(to)) return null;
    if (from === to) return [from];
    const prev = new Map<number, number>([[from, 0]]);
    const queue = [from];
    while (queue.length) {
        const cur = queue.shift()!;
        for (const nx of NEIGHBORS.get(cur) ?? []) {
            if (prev.has(nx)) continue;
            prev.set(nx, cur);
            if (nx === to) {
                const path = [to];
                let step = to;
                while (step !== from) { step = prev.get(step)!; path.push(step); }
                return path.reverse();
            }
            queue.push(nx);
        }
    }
    return null;
}

function routeCurve(a: number, b: number): string {
    const pa = POINT_BY_ID.get(a)!;
    const pb = POINT_BY_ID.get(b)!;
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(1.6, len * 0.14);
    return `M ${pa.x} ${pa.y} Q ${(mx - (dy / len) * bow).toFixed(2)} ${(my + (dx / len) * bow).toFixed(2)} ${pb.x} ${pb.y}`;
}

/** Glows the walking route from the player's sector to a hovered/travelling
 *  destination over the world map. Renders nothing without a valid route. */
export function RouteGlowOverlay({ from, to }: { from: number; to: number | null }) {
    if (to == null || to === from) return null;
    const route = walkingRoute(from, to);
    if (!route || route.length < 2) return null;
    const hops = route.length - 1;
    return (
        <svg className="world-route-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {route.slice(0, -1).map((sector, i) => (
                <path key={`${sector}-${route[i + 1]}`} d={routeCurve(sector, route[i + 1])} className="world-route-glow" vectorEffect="non-scaling-stroke" />
            ))}
            <title>{`${hops} crossing${hops === 1 ? "" : "s"} on foot`}</title>
        </svg>
    );
}

/* ── Walk-in helper ──────────────────────────────────────────────────────── */

const GRID_W = 12;

/** One tile back TOWARD the edge the player crossed through, or null when that
 *  would leave the board (east/west must not wrap onto the next row). */
function outwardStep(tile: number, direction: SectorDirection): number | null {
    const col = tile % GRID_W;
    const row = Math.floor(tile / GRID_W);
    if (direction === "north") return row < GRID_W - 1 ? tile + GRID_W : null;
    if (direction === "south") return row > 0 ? tile - GRID_W : null;
    if (direction === "east") return col > 0 ? tile - 1 : null;
    return col < GRID_W - 1 ? tile + 1 : null;
}

/**
 * The tiles the avatar walks through on arrival, boundary seam FIRST and
 * `arrivalTile` LAST.
 *
 * A crossing is a big displacement — going north moves you from row 0 of one
 * board to row 11 of the next — so without a visible entry the arrival reads as
 * a teleport down the map rather than as walking through a gate. Stepping out
 * to the seam and walking back in is what sells the direction you came from.
 * `WALK_IN_DEPTH` (shared/sector-links.ts) sets how far in a crossing lands and
 * therefore how many steps this returns; the path is clamped to the board, so a
 * degenerate case just yields a shorter walk rather than an off-board tile.
 */
export function walkInPath(arrivalTile: number, direction: SectorDirection): number[] {
    const outward: number[] = [];
    let cursor = arrivalTile;
    for (let step = 0; step < WALK_IN_DEPTH; step++) {
        const next = outwardStep(cursor, direction);
        if (next == null) break;
        cursor = next;
        outward.push(cursor);
    }
    return [...outward.reverse(), arrivalTile];
}

/** The boundary tile the player physically steps in FROM when arriving at
 *  `arrivalTile` after walking `direction`. Falls back to the arrival tile when
 *  no step inward is possible. */
export function walkInEntryTile(arrivalTile: number, direction: SectorDirection): number {
    return walkInPath(arrivalTile, direction)[0];
}
