/* eslint-disable react-refresh/only-export-components -- pure route and region helpers are co-located for focused tests */
/*
 * WorldWalkFeel — the threshold-moment layer for walking the world:
 *
 *   RegionSplash      Elden-Ring-style region-name calligraphy card, shown once
 *                     per region per session when the player enters it.
 *   RouteGlowOverlay  shortest walking route (BFS over the shared road graph)
 *                     glowed onto the world map while hovering a destination.
 *
 * Styles live in world-walk-feel.css, imported by the WorldMap SCREEN
 * (components must not import CSS — it breaks the node test runner).
 */
import { useEffect, useRef } from "react";
import { SECTOR_ROAD_PAIRS } from "../../../shared/sector-links";
import { ATLAS_SECTOR_POINTS } from "../data/sector-points";
import { sectorRegionKey, sectorRegionLabel, type SectorRegionKey } from "../../../shared/sector-geo";

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

const POINT_BY_ID = new Map(ATLAS_SECTOR_POINTS.map((p) => [p.id, p]));
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

/* The animated per-tile walk-in that used to live here was removed on
 * 2026-07-30: it moved the player's avatar across the new sector on its own,
 * which reads as the character wandering off under someone else's control. A
 * crossing now places the player on the entry edge and stops. See WALK_IN_DEPTH
 * in shared/sector-links.ts. */
