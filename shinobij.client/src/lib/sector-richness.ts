/**
 * How much a sector's shared daily gathering pool has left — and where to go
 * when the one you are standing in has nothing.
 *
 * The pool is the game's one honest reason to travel: 1,500 explores per sector
 * per day, drawn from by EVERYONE standing there, so busy roads run dry while
 * quiet ones stay fat. That mechanic was invisible. `SECTOR_DEPLETED_MESSAGE`
 * has always told the player "other sectors are still rich" without giving them
 * any way to see which, so "Picked clean" read as a dead end rather than as a
 * signpost.
 *
 * Nothing here talks to the server. `lib/sector-pool` already caches the raw
 * per-sector counts from the world-state poll for the whole board, so a
 * richness verdict for any sector — and the search below for a richer one — is
 * pure projection over data the client already holds.
 */
import { SECTOR_ROAD_PAIRS } from "../../../shared/sector-links";
import { sectorPoolViewFor, type SectorPoolPlateView } from "./sector-pool";

/** How much of the day's pool a sector has left. */
export type SectorRichness =
    /** Untouched or barely worked — the pool is the reason to come here. */
    | "rich"
    /** Most of the day's take is gone; it will run out. */
    | "worked"
    /** Nothing more today. */
    | "spent"
    /** No poll has landed yet — say nothing rather than guess. */
    | "unknown";

/** Fraction drawn at which a sector stops reading as rich. */
const WORKED_AT = 0.6;

export function sectorRichnessOf(view: SectorPoolPlateView | null | undefined): SectorRichness {
    if (!view || !view.hydrated || view.exploresCap <= 0) return "unknown";
    if (view.exploresUsed >= view.exploresCap) return "spent";
    return view.exploresUsed / view.exploresCap >= WORKED_AT ? "worked" : "rich";
}

/** A short phrase for the marker tooltip; null when there is nothing to say. */
export function sectorRichnessLabel(richness: SectorRichness): string | null {
    switch (richness) {
        case "rich": return "Rich ground";
        case "worked": return "Worked over";
        case "spent": return "Picked clean today";
        case "unknown": return null;
    }
}

/* ── Finding richer ground ───────────────────────────────────────────────── */

const NEIGHBORS = (() => {
    const map = new Map<number, number[]>();
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        if (!map.has(a)) map.set(a, []);
        if (!map.has(b)) map.set(b, []);
        map.get(a)!.push(b);
        map.get(b)!.push(a);
    }
    return map;
})();

export type RicherSector = { sector: number; hops: number };

/**
 * The nearest sectors by ROAD that still have pool left, closest first.
 *
 * Breadth-first over the same road graph the player actually walks, so an
 * answer is always somewhere they can reach — never "go to the far side of the
 * world". `resolveOwner` supplies each candidate's owning village because the
 * cap carries a bonus for the viewer's own village, and the pool a sector has
 * left is therefore a question about who is asking.
 */
export function richerSectorsNear(
    from: number,
    viewerVillage: string | undefined,
    resolveOwner: (sector: number) => string | undefined,
    limit = 3,
): RicherSector[] {
    if (!NEIGHBORS.has(from) || limit <= 0) return [];
    const found: RicherSector[] = [];
    const seen = new Set<number>([from]);
    let frontier = [from];
    let hops = 0;
    // The graph is ~60 nodes; the hop bound is a belt-and-braces stop, not a
    // reachability limit — a connected graph is exhausted long before it.
    while (frontier.length && found.length < limit && hops < 12) {
        hops++;
        const next: number[] = [];
        for (const cur of frontier) {
            for (const candidate of NEIGHBORS.get(cur) ?? []) {
                if (seen.has(candidate)) continue;
                seen.add(candidate);
                next.push(candidate);
                const view = sectorPoolViewFor(candidate, resolveOwner(candidate), viewerVillage);
                if (sectorRichnessOf(view) === "rich") found.push({ sector: candidate, hops });
                if (found.length >= limit) break;
            }
            if (found.length >= limit) break;
        }
        frontier = next;
    }
    return found;
}
