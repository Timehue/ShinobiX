/**
 * Cinderhold's shinobi beyond their home land (2026-11-10).
 *
 * Pure geography and small in-memory registries the presence tick
 * (api/_npc-presence.ts) reads every 20 s, so nothing here scans the save
 * registry or writes a row:
 *
 *   - the ROAM GROUND: every walkable sector in the world (owner ruling
 *     2026-11-11: "let the Cinderhold NPC go anywhere in the world"), the player
 *     villages' home blocks, outskirts and the castle city included, and the
 *     road graph it walks to get there. Only the two sectors that are screens,
 *     not walkable maps (the festival, Death's Gate), are left out. A rival hunt
 *     still never strikes a player inside their own village's block
 *     (api/_npc-hunt.ts npcHuntSectorAllowed).
 *   - ROAD HOPS: a move follows SECTOR_ROAD_PAIRS one road at a time, as a
 *     player walking the map does, instead of one jump (the journey walker,
 *     api/_npc-journeys.ts, walks each sector tile by tile to the next road).
 *   - GATHERING (cosmetic): an NPC whose journey takes it to a gathering node
 *     stands one tile off the node's approach tile; its presence row carries
 *     `activity` (no client screen shows it, as none shows a gathering
 *     player's). Nothing is claimed: no node row, no pool, no inventory is
 *     ever touched.
 *   - the WORLD BOSS's current sector (cached), so a few roaming NPCs can stand
 *     there while a boss event is live. Presence only.
 *   - the live RIVAL HUNTS (api/_npc-hunt.ts owns them; the presence tick only
 *     reads where each hunter is heading).
 */
import {
    CINDERHOLD_SECTORS, FESTIVAL_SECTOR, PLAYABLE_WILD_SECTOR_IDS,
} from '../shared/sector-geo.js';
import { NON_WALKABLE_SECTORS, SECTOR_ROAD_PAIRS } from '../shared/sector-links.js';
import { SECTOR_GRID_WIDTH, isWalkableTile } from '../shared/sector-walk-mask.js';
import { HARVEST_NODES, RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES, type ResourceNode } from '../shared/resource-nodes.js';

// --- Roam ground and roads --------------------------------------------------

/** Sectors an NPC never roams to or walks through: the ones that are screens, not walkable maps. */
const FORBIDDEN: ReadonlySet<number> = new Set([FESTIVAL_SECTOR, ...NON_WALKABLE_SECTORS]);
const candidates = new Set(PLAYABLE_WILD_SECTOR_IDS.filter((s) => !FORBIDDEN.has(s)));

/** Road neighbours inside the NPC's ground (Cinderhold, the roam pool and the castle roads), ascending. */
const NEIGHBOURS: ReadonlyMap<number, readonly number[]> = (() => {
    const out = new Map<number, number[]>();
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        if (!candidates.has(a) || !candidates.has(b)) continue;
        out.set(a, [...(out.get(a) ?? []), b]);
        out.set(b, [...(out.get(b) ?? []), a]);
    }
    for (const list of out.values()) list.sort((x, y) => x - y);
    return out;
})();

/** Road distance from Cinderhold to every sector its shinobi can walk to. */
const DISTANCE_FROM_HOME: ReadonlyMap<number, number> = (() => {
    const distance = new Map<number, number>(CINDERHOLD_SECTORS.map((s) => [s, 0]));
    const queue = [...CINDERHOLD_SECTORS];
    for (let i = 0; i < queue.length; i++) {
        const at = queue[i]!;
        for (const next of NEIGHBOURS.get(at) ?? []) {
            if (distance.has(next)) continue;
            distance.set(next, distance.get(at)! + 1);
            queue.push(next);
        }
    }
    return distance;
})();

/**
 * The sectors an NPC with no war duty may roam to: every walkable sector its
 * shinobi can reach on foot, Cinderhold's own included (the whole world map but
 * the festival and Death's Gate screens).
 */
export const NPC_ROAM_SECTORS: readonly number[] = [...DISTANCE_FROM_HOME.keys()].sort((a, b) => a - b);
const ROAM_SET = new Set(NPC_ROAM_SECTORS);
/** Every sector a Cinderhold shinobi's road walk may touch outside an order: home, the roam ground and the castle roads. */
export const NPC_GROUND_SECTORS: ReadonlySet<number> = new Set(DISTANCE_FROM_HOME.keys());

export function isNpcRoamSector(sector: number): boolean { return ROAM_SET.has(sector); }

// The old roam share (40% of free NPCs per 30-minute window) and its cap of two
// roamers per sector are retired (owner ruling 2026-11-11): every free
// Cinderhold shinobi is out on a journey (api/_npc-journeys.ts), and none of
// them counts toward any per-sector cap.

function bfsRoute(from: number, to: number, avoid: ReadonlySet<number> | null): number[] | null {
    const previous = new Map<number, number>([[from, from]]);
    const queue = [from];
    for (let i = 0; i < queue.length && !previous.has(to); i++) {
        const at = queue[i]!;
        for (const next of NEIGHBOURS.get(at) ?? []) {
            if (previous.has(next) || (avoid?.has(next) && next !== to)) continue;
            previous.set(next, at);
            queue.push(next);
        }
    }
    if (!previous.has(to)) return null;
    const route = [to];
    while (route[route.length - 1] !== from) route.push(previous.get(route[route.length - 1]!)!);
    return route.reverse();
}

/**
 * The shortest road route inside the NPC ground, both ends included, or null.
 * With `avoid`, a route that keeps out of those sectors (war fronts, say) is
 * preferred; when none exists the plain shortest route is used.
 */
export function npcRoadRoute(from: number, to: number, avoid?: ReadonlySet<number>): number[] | null {
    if (from === to) return [from];
    if (!NPC_GROUND_SECTORS.has(from) || !NPC_GROUND_SECTORS.has(to)) return null;
    return (avoid?.size ? bfsRoute(from, to, avoid) : null) ?? bfsRoute(from, to, null);
}

/** The next road an NPC takes from `from` toward `to`, or null when no road inside its ground leads there. */
export function npcRoadNextHop(from: number, to: number, avoid?: ReadonlySet<number>): number | null {
    const route = npcRoadRoute(from, to, avoid);
    return route && route.length > 1 ? route[1]! : null;
}

/** Road hops between every pair of ground sectors, worked out once. */
const HOPS: ReadonlyMap<number, ReadonlyMap<number, number>> = (() => {
    const out = new Map<number, Map<number, number>>();
    for (const from of DISTANCE_FROM_HOME.keys()) {
        const distance = new Map<number, number>([[from, 0]]);
        const queue = [from];
        for (let i = 0; i < queue.length; i++) {
            const at = queue[i]!;
            for (const next of NEIGHBOURS.get(at) ?? []) {
                if (distance.has(next)) continue;
                distance.set(next, distance.get(at)! + 1);
                queue.push(next);
            }
        }
        out.set(from, distance);
    }
    return out;
})();

/** Road hops from `from` to `to` on the NPC ground (0 for the same sector), or null when no road leads there. */
export function npcRoadDistance(from: number, to: number): number | null {
    return HOPS.get(from)?.get(to) ?? null;
}

// --- Gathering (cosmetic) ---------------------------------------------------

export type NpcGatherActivity = 'mining' | 'fishing' | 'harvesting';

/** Every tile a gatherer stands on to work a node (event crystals included), per sector. */
const APPROACH_TILES: ReadonlyMap<number, ReadonlySet<number>> = (() => {
    const out = new Map<number, Set<number>>();
    for (const node of [...RESOURCE_NODES, ...HARVEST_NODES, ...WORLD_BOSS_CRYSTAL_NODES]) {
        const set = out.get(node.sector) ?? new Set<number>();
        set.add(node.approach);
        out.set(node.sector, set);
    }
    return out;
})();

/** Whether a tile is where a player stands to gather (an NPC never stands there). */
export function isNodeApproachTile(sector: number, tile: number): boolean {
    return APPROACH_TILES.get(sector)?.has(tile) === true;
}

function neighbourTiles(tile: number): number[] {
    const col = tile % SECTOR_GRID_WIDTH, row = Math.floor(tile / SECTOR_GRID_WIDTH);
    const out: number[] = [];
    // Sides first, then corners: "one tile off" reads best beside the gatherer's spot.
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const c = col + dc, r = row + dr;
        if (c >= 0 && r >= 0 && c < SECTOR_GRID_WIDTH && r < SECTOR_GRID_WIDTH) out.push(r * SECTOR_GRID_WIDTH + c);
    }
    return out;
}

/** A walkable tile that is no gatherer's spot: `tile` itself, else its nearest such neighbour. */
export function npcStandTile(sector: number, tile: number): number {
    if (!isNodeApproachTile(sector, tile)) return tile;
    return neighbourTiles(tile).find((t) => isWalkableTile(sector, t) && !isNodeApproachTile(sector, t)) ?? tile;
}

/**
 * Where a shinobi may stand to gather at `node`: one tile off its approach tile
 * (never on it, nor on the node itself, nor on any other gatherer's spot).
 */
export function npcNodeStandTiles(node: Pick<ResourceNode, 'sector' | 'approach' | 'target'>): number[] {
    return neighbourTiles(node.approach)
        .filter((t) => t !== node.target && isWalkableTile(node.sector, t) && !isNodeApproachTile(node.sector, t));
}

/** Every gathering node on the NPC ground (event crystal veins excluded), for journeys. */
export const NPC_GATHER_NODES: readonly ResourceNode[] = [...RESOURCE_NODES, ...HARVEST_NODES].filter((node) => NPC_GROUND_SECTORS.has(node.sector));

// --- World boss --------------------------------------------------------------

/** Roaming shinobi who go and stand where a live world boss is (presence only). */
export const NPC_BOSS_WATCHERS = 3;
let bossCache: { at: number; sector: number | null } | null = null;
const BOSS_CACHE_MS = 60_000;

/**
 * The live world boss's current sector when an NPC may stand there (it is on
 * the roam ground), else null. Read at most once a minute; a storage hiccup
 * reads as "no boss".
 */
export async function npcWorldBossSector(now = Date.now()): Promise<number | null> {
    if (bossCache && now - bossCache.at < BOSS_CACHE_MS && now >= bossCache.at) return bossCache.sector;
    let sector: number | null = null;
    try {
        const { readActiveWorldBossEvent, worldBossEventIsOpen } = await import('./world-boss-event/_event.js');
        const { worldBossEventPosition, worldBossEventStatus } = await import('../shared/world-boss-event.js');
        const event = await readActiveWorldBossEvent();
        if (event && worldBossEventIsOpen({ ...event, status: worldBossEventStatus(event, now) }, now)) {
            const position = worldBossEventPosition(event, now);
            if (position?.active && isNpcRoamSector(position.currentSector)) sector = position.currentSector;
        }
    } catch { sector = null; }
    bossCache = { at: now, sector };
    return sector;
}
export function resetNpcWorldBossCacheForTest(): void { bossCache = null; }

// --- Rival hunts (owned by api/_npc-hunt.ts) ---------------------------------

export type NpcHunt = {
    npc: string;
    /** The rival's slug. */
    target: string;
    /** Where the hunter is heading: the rival's sector when last seen. */
    sector: number;
    since: number;
    /** Times the hunt followed the rival to a new sector. */
    follows: number;
    /** The hunt lapses at this moment if it has not struck. */
    until: number;
    /** The rival's home block (never struck there). */
    homes: number[];
};
const hunts = new Map<string, NpcHunt>();
/** Every live hunt, by NPC id (read by the presence tick; written only by api/_npc-hunt.ts). */
export function npcHuntRegistry(): Map<string, NpcHunt> { return hunts; }
