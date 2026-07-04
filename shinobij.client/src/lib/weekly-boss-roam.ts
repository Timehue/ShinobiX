/*
 * Roaming weekly-boss position — Phase 1 (roaming-weekly-boss-plan).
 *
 * The weekly world boss wanders sector to sector across its 72h rampage. Its
 * position is a PURE FUNCTION of the live boss state (weekKey + startedAt) and
 * the wall clock — no realtime sync — so every client computes the identical
 * sector at the same instant, exactly like lib/weekly-boss.ts derives the
 * schedule and lib/wanderers.ts derives the roster.
 *
 *   hop     = floor((now - startedAt) / HOP_INTERVAL)
 *   seed    = FNV-1a("wbroam:" + weekKey)
 *   path    = a CONNECTED walk: from a seeded start sector, each hop steps to a
 *             seeded *adjacent* sector (nearest-neighbour on the world scatter) —
 *             no teleporting, so the trail reads as a creature crossing the map
 *   current = path[hop] ; next = path[hop+1] (telegraphed)
 *
 * Leaf module: depends only on the sector scatter (data/sector-points) and the
 * boss-state shape. No React, no UI — Phase 2 renders a marker from this; Phase 3
 * spawns the in-sector actor when the player enters `currentSector`.
 *
 * Shipping inert: nothing imports this yet; it is wired behind `weeklyBossRoam.v1`
 * in later phases.
 */

import { SECTOR_POINTS } from "../data/sector-points";

// Opt-IN flag (default OFF), so the whole roaming layer ships inert until we
// flip it — the inverse of wanderers.v1 (which defaults on). Turn on per-device
// with localStorage `weeklyBossRoam.v1 = "on"`.
export function isWeeklyBossRoamEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("weeklyBossRoam.v1") === "on"; } catch { return false; }
}

// Per-player back-off after a roaming-boss encounter, so it doesn't immediately
// re-lunge when you re-enter its sector. Stored in `character.wandererCooldowns`
// under this key (reuses that self-pruning map; keyed by weekKey so it resets
// each spawn). This is UX pacing only — the hard 3-attempt cap is enforced
// server-side by /api/weekly-boss.
export function weeklyBossRoamCooldownId(weekKey: string): string {
    return `weeklyboss-${weekKey}`;
}
export const WEEKLY_BOSS_ROAM_FIGHT_COOLDOWN_MS = 35 * 60 * 1000; // ~35 min after a fight

// ── Tuning knobs (see plan; safe to change without touching callers) ──────────

// ~13 min per sector hop. Long enough to travel and intercept the boss; short
// enough that camping one sector doesn't work. The next hop is always telegraphed.
export const WEEKLY_BOSS_HOP_INTERVAL_MS = 13 * 60 * 1000;

// How many recent sectors to expose as the visible trail (where it came from).
export const WEEKLY_BOSS_TRAIL_LEN = 4;

// Each hop steps to one of the boss's K nearest sectors — a connected walk that
// never dead-ends (every sector always has K neighbours).
const ROAM_NEIGHBOR_K = 5;

// The boss roams the 60 standard sectors. Sector 99 (the special lava-arena slot)
// is excluded — it isn't a normal overworld destination.
const ROAM_SECTOR_IDS: readonly number[] = SECTOR_POINTS
    .filter((p) => p.id >= 1 && p.id <= 60)
    .map((p) => p.id);

export type WeeklyBossRoamInput = {
    weekKey: string;
    startedAt: number;
    expiresAt?: number;
};

export type WeeklyBossRoamState = {
    /** false before the boss has started or once it has despawned/expired. */
    active: boolean;
    /** Sector (1–60) the boss is in right now. */
    currentSector: number;
    /** The telegraphed next hop (a neighbour of currentSector). */
    nextSector: number;
    /** Recent sectors, oldest → newest, EXCLUDING the current one. */
    trail: number[];
    /** How many hops have elapsed since spawn. */
    hopIndex: number;
    /** Milliseconds until the boss hops to nextSector. */
    nextHopInMs: number;
    /** The hop interval used (echoed for the countdown UI). */
    hopIntervalMs: number;
};

// FNV-1a — identical algorithm to lib/weekly-boss.ts `seededHash`, so the roam
// seed is derived from the same weekKey and stays consistent across clients.
function fnv1a(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

// A well-mixed per-hop value so each hop's neighbour choice is deterministic and
// evenly distributed (a cheap integer hash of seed⊕hop).
function hopRand(seed: number, hop: number): number {
    let h = (seed ^ Math.imul(hop + 1, 2654435761)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

// Each roam sector's K nearest neighbours by Euclidean distance on the scatter,
// precomputed once. Distance ties break by lower id so the graph is fully
// deterministic (identical on every client).
const NEIGHBORS: ReadonlyMap<number, readonly number[]> = (() => {
    const pts = SECTOR_POINTS.filter((p) => p.id >= 1 && p.id <= 60);
    const map = new Map<number, number[]>();
    for (const a of pts) {
        const near = pts
            .filter((b) => b.id !== a.id)
            .map((b) => ({ id: b.id, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
            .sort((u, v) => u.d - v.d || u.id - v.id)
            .slice(0, ROAM_NEIGHBOR_K)
            .map((n) => n.id);
        map.set(a.id, near);
    }
    return map;
})();

/** Neighbours of a roam sector (its K nearest by distance). Exported for tests. */
export function roamNeighbors(sector: number): readonly number[] {
    return NEIGHBORS.get(sector) ?? [];
}

// The sector the boss started in (hop 0), seeded off the week.
function startSector(seed: number): number {
    return ROAM_SECTOR_IDS[seed % ROAM_SECTOR_IDS.length];
}

// Walk the connected path from the start sector through `hop` steps. O(hop) — but
// hop is tiny over a 72h window (72h / 13min ≈ 332). Returns path[0..hop].
function roamPath(seed: number, hop: number): number[] {
    const path: number[] = [startSector(seed)];
    for (let i = 1; i <= hop; i += 1) {
        const prev = path[i - 1];
        const neighbors = NEIGHBORS.get(prev) ?? [prev];
        // Prefer not to immediately backtrack to the sector we just left, so the
        // path reads as forward travel rather than bouncing between two sectors.
        const cameFrom = i >= 2 ? path[i - 2] : -1;
        const forward = neighbors.filter((n) => n !== cameFrom);
        const pool = forward.length ? forward : neighbors;
        path.push(pool[hopRand(seed, i) % pool.length]);
    }
    return path;
}

/**
 * Where is the roaming weekly boss right now?
 *
 * @param boss  the live weekly-boss state (needs weekKey + startedAt; expiresAt
 *              optional) — or null/undefined when no boss is spawned.
 * @param now   wall-clock ms (pass Date.now(); injected for testability).
 * @returns     the derived roam state, or null when there is no boss to place.
 */
export function weeklyBossRoamState(
    boss: WeeklyBossRoamInput | null | undefined,
    now: number,
    hopIntervalMs: number = WEEKLY_BOSS_HOP_INTERVAL_MS,
): WeeklyBossRoamState | null {
    if (!boss || !boss.weekKey || !Number.isFinite(boss.startedAt)) return null;
    const interval = hopIntervalMs > 0 ? hopIntervalMs : WEEKLY_BOSS_HOP_INTERVAL_MS;
    const elapsed = now - boss.startedAt;
    const started = elapsed >= 0;
    const expired = typeof boss.expiresAt === "number" && now >= boss.expiresAt;
    const hop = started ? Math.floor(elapsed / interval) : 0;
    const seed = fnv1a("wbroam:" + boss.weekKey);
    const path = roamPath(seed, hop + 1); // +1 so path[hop+1] (nextSector) exists
    const trailStart = Math.max(0, hop - WEEKLY_BOSS_TRAIL_LEN);
    const currentSector = path[hop];
    return {
        active: started && !expired,
        currentSector,
        nextSector: path[hop + 1],
        // Recent sectors before the current one. Filter out the current sector:
        // the walk can loop back onto a sector it passed a few hops ago, and it
        // shouldn't render as both "here" and "recently visited".
        trail: path.slice(trailStart, hop).filter((s) => s !== currentSector),
        hopIndex: hop,
        nextHopInMs: started ? interval - (elapsed % interval) : 0,
        hopIntervalMs: interval,
    };
}
