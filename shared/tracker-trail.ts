/*
 * Tracker trail — the Tracker wanderer's "Follow tracks" lead, shared by client
 * and server.
 *
 * A tracker (Ibo the Tracker and friends, shared/wanderer-roster.ts) points the
 * player at tracks that cross TWO nearby sectors: the first holds more tracks,
 * the second holds a wild pet that enters the normal wild-binding battle
 * (api/pet/wild-binding.ts, docs/wild-pet-binding-system.md). The route is
 * derived from the trail id and the sector it started in, and follows real
 * roads (shared/sector-links.ts), so it always leads somewhere you can walk.
 *
 * The server owns the trail row (api/sector/_tracker-trail.ts); the copy on the
 * character is only a display mirror. Keep this module dependency-free apart
 * from shared/ so both sides can import it.
 */
import { sectorExits, NON_WALKABLE_SECTORS } from "./sector-links.js";
import { isPlayableWildSector, MAX_WILD_SECTOR } from "./sector-geo.js";

/** A trail goes cold if it is not followed to the end within this window. */
export const TRACKER_TRAIL_TTL_MS = 2 * 60 * 60 * 1000;

/** Number of sectors the tracks cross. The pet waits in the last one. */
export const TRACKER_TRAIL_LEGS = 2;

export type TrackerTrail = {
    id: string;
    /** The sealed wild-encounter request id the final sector mints under. */
    requestId: string;
    /** The tracker who gave the lead (roster name). */
    giver: string;
    originSector: number;
    /** [tracks sector, pet sector] */
    sectors: [number, number];
    /** 0 = heading to the tracks sector, 1 = heading to the pet sector. */
    step: 0 | 1;
    expiresAt: number;
    /** Set once the final sector has minted its wild encounter. */
    flushedAt?: number;
};

function hash32(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

const NON_WALKABLE = new Set(NON_WALKABLE_SECTORS);

function walkableNeighbours(sector: number): number[] {
    return [...new Set(sectorExits(sector).map((exit) => exit.destinationSector))]
        .filter((id) => isPlayableWildSector(id) && !NON_WALKABLE.has(id))
        .sort((a, b) => a - b);
}

function fallbackSector(key: string, exclude: readonly number[]): number {
    let dest = 1 + (hash32(key) % MAX_WILD_SECTOR);
    for (let guard = 0; guard <= MAX_WILD_SECTOR; guard++) {
        if (isPlayableWildSector(dest) && !NON_WALKABLE.has(dest) && !exclude.includes(dest)) return dest;
        dest = (dest % MAX_WILD_SECTOR) + 1;
    }
    return 1;
}

/**
 * The two sectors a trail crosses, deterministic from (trailId, origin). The
 * first is a road neighbour of the origin; the second is a road neighbour of
 * the first that is neither the origin nor the first. Never returns the origin.
 */
export function trackerTrailSectors(trailId: string, originSector: number): [number, number] {
    const firstOptions = walkableNeighbours(originSector).filter((id) => id !== originSector);
    const first = firstOptions.length
        ? firstOptions[hash32(`trail:${trailId}:${originSector}:a`) % firstOptions.length]
        : fallbackSector(`trail:${trailId}:${originSector}:a`, [originSector]);
    const secondOptions = walkableNeighbours(first).filter((id) => id !== originSector && id !== first);
    const second = secondOptions.length
        ? secondOptions[hash32(`trail:${trailId}:${first}:b`) % secondOptions.length]
        : fallbackSector(`trail:${trailId}:${first}:b`, [originSector, first]);
    return [first, second];
}

/** The sector the player must reach next. */
export function trackerTrailNextSector(trail: Pick<TrackerTrail, "sectors" | "step">): number {
    return trail.sectors[trail.step === 1 ? 1 : 0];
}

/** Sanitise an untrusted trail row. Returns null for anything malformed. */
export function cleanTrackerTrail(raw: unknown): TrackerTrail | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    const id = typeof v.id === "string" && /^trail-[A-Za-z0-9_-]{8,120}$/.test(v.id) ? v.id : "";
    const requestId = typeof v.requestId === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(v.requestId) ? v.requestId : "";
    const sectors = Array.isArray(v.sectors) ? v.sectors.map((s) => Math.floor(Number(s))) : [];
    const originSector = Math.floor(Number(v.originSector));
    const expiresAt = Math.floor(Number(v.expiresAt));
    const flushedAt = Math.floor(Number(v.flushedAt));
    if (!id || !requestId || sectors.length !== 2 || !sectors.every(isPlayableWildSector)
        || !isPlayableWildSector(originSector) || !Number.isSafeInteger(expiresAt) || expiresAt <= 0
        || (v.step !== 0 && v.step !== 1)) return null;
    return {
        id,
        requestId,
        giver: typeof v.giver === "string" ? v.giver.slice(0, 48) : "The tracker",
        originSector,
        sectors: [sectors[0], sectors[1]],
        step: v.step,
        expiresAt,
        ...(Number.isSafeInteger(flushedAt) && flushedAt > 0 ? { flushedAt } : {}),
    };
}

// ── Presentation ─────────────────────────────────────────────────────────────
// What the tracker says at each stop. Picked from the trail id so the same
// trail always reads the same on every device.

const TRACKS_LINES = [
    "Here. Toe-prints, deep at the front. It was running, and it didn't stop to drink.",
    "See the bent grass? It went through here low and fast. We're close to where it sleeps.",
    "Fur on the thorns, and still warm. It knows this road better than we do.",
];

const BEAST_LINES = [
    "Quiet now. It's just past those rocks, and it hasn't smelled us yet.",
    "There. Don't look straight at it. Let it decide you're not a threat.",
    "That's our beast. Tired from running, which makes this the best chance you'll get.",
];

function pick(lines: readonly string[], key: string): string {
    return lines[hash32(key) % lines.length];
}

export function trackerTrailTracksLine(trailId: string): string {
    return pick(TRACKS_LINES, `${trailId}:tracks`);
}

export function trackerTrailBeastLine(trailId: string): string {
    return pick(BEAST_LINES, `${trailId}:beast`);
}
