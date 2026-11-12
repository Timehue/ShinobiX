/**
 * Cinderhold's shinobi on the move (owner ruling 2026-11-11).
 *
 * "All 30 ... out and about to make the world feel more alive ... unless
 * attacked are walking sector to sector and looking like they are moving with
 * a purpose." Every NPC with no war duty is on a JOURNEY: it always has a
 * destination and a reason, walks there like a player, does the thing for a
 * few minutes, then picks the next one. None of them counts toward any
 * per-sector cap.
 *
 *   - DESTINATIONS (JOURNEY_SPOTS, pure geography worked out once): a gathering
 *     node (it gathers there, cosmetically: the same `activity` the roster
 *     shows, never a claim on the node, never ON the approach tile), a shrine,
 *     a cairn, a stronghold, a rift site, another village's outskirts gate, a
 *     river bridge, a crossroads (a sector with four or more roads), the
 *     castle city's streets, and Cinderhold itself now and then. The kind is
 *     drawn by personality (medics favour shrines and herbs, the aggressive
 *     strongholds and crossroads, guardians the gates, tricksters rifts and
 *     cairns), the place uniformly over the whole roam ground, nearer or
 *     farther by a seeded reach, never the sector it stands in, a war front or
 *     the world boss's sector, nor one of its last three stops. Every draw is
 *     seeded by the NPC, its journey seed and its leg number, so tests and a
 *     restart inside the same hour see the same plan.
 *   - ERRANDS: a rival hunt (api/_npc-hunt.ts) and watching the world boss are
 *     journeys too, with that purpose: the presence tick points the journey at
 *     the target sector and it stays until the errand is over.
 *   - WALKING: inside a sector it steps tile by tile along a walkable path
 *     (shared/sector-walk-mask.ts walkPath, obstacles honoured) to the exit of
 *     the next road, at a player's walking pace (WORLD_WALK_SPEED tiles a
 *     second, the speed the world-movement gate allows a player), then crosses
 *     the border at once, as a walking player does (no lease, so the next
 *     sector shows it straight away), lands on the road's arrival tile and
 *     walks on. Routes keep out of war fronts where they can.
 *   - COST: stepNpcJourneys runs every NPC_WALK_TICK_MS from the presence
 *     module's timer and is synchronous and in memory only: onlineStore moves
 *     (moveToTile, startTravel) and, per moving NPC per step, the two deltas a
 *     walking player's step sends (`presence:move` and `presence:world`;
 *     announceNpcStep). No storage at all; the 20 s presence tick stays the
 *     NPC's heartbeat (save projection, possession, combat evidence) and tells
 *     this module who is free.
 *   - UNLESS ATTACKED: an admitted attack, a duel opening on it
 *     (api/_npc-attack-hold.ts) or a fight pins the NPC where it stands; once
 *     free it carries on with the same journey. Beaten, it stays put until the
 *     tick takes it to hospital.
 *
 * Journeys live in memory and start fresh after a restart: an NPC already on
 * the map carries on from where it stands; one returning from its time off
 * starts where it left; one back from hospital starts in Cinderhold; anyone
 * else starts part-way through a seeded stop somewhere in the world, so a
 * restart never sends all thirty back to Cinderhold at once.
 */
import { onlineStore } from './_realtime/online-store.js';
import { queuePresenceUpdate } from './_realtime/presence-broadcast.js';
import { pushTileMovement, pushWorldMovement } from './_realtime/notify.js';
import { worldPositionModel } from '../shared/continuous-world-layout.js';
import { npcPinned } from './_npc-attack-hold.js';
import { WORLD_WALK_SPEED } from './_realtime/world-movement.js';
import { sectorGaitTilesPerSecond } from '../shared/sector-gait-rates.js';
import type { OnlinePlayer } from './_realtime/types.js';
import { sectorObstaclesEnabled } from './_release-flags.js';
import type { NpcPersonality, NpcShinobi } from '../shared/npc-village-roster.js';
import { CASTLE_SECTORS, CINDERHOLD_SECTORS, OUTSKIRTS_SECTORS, sectorArtKey } from '../shared/sector-geo.js';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';
import { sectorExits, travelArrivalTile } from '../shared/sector-links.js';
import { SECTOR_GRID_WIDTH, isWalkableTile, nearestWalkableTile, tileNeighbors, walkPath } from '../shared/sector-walk-mask.js';
import { harvestBloom } from '../shared/resource-nodes.js';
import {
    NPC_GATHER_NODES, NPC_ROAM_SECTORS, isNodeApproachTile, npcNodeStandTiles, npcRoadDistance, npcRoadNextHop, npcStandTile,
    type NpcGatherActivity,
} from './_npc-roam.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** How often the walker advances every walking NPC (each by the steps its elapsed time covers). */
export const NPC_WALK_TICK_MS = 500;
/** A player's walking pace (the world-movement gate's sustained speed), in tiles a second. */
export const NPC_WALK_TILES_PER_SECOND = WORLD_WALK_SPEED;
/** A stalled walker (a long event-loop pause) never banks more ground than this much walking. */
export const NPC_WALK_MAX_CATCHUP_MS = 4_000;
/**
 * The lease an ORDERED trip takes (a war or clan-war order sends an NPC
 * straight to a sector it may not border): a player's far trip, three seconds.
 * A walker crossing a road to the next sector takes none, like a player
 * walking over a border in the continuous world (player/travel.ts: an
 * adjacent road crossing is instant), so it never vanishes at the edge.
 */
export const NPC_TRAVEL_MS = 3_000;
let travelMs = NPC_TRAVEL_MS;
/** Tests shorten the ordered trip: the presence store keeps its own clock, which mocked timers do not move. */
export function setNpcTravelMsForTest(ms: number): void { travelMs = Math.max(0, ms); }
/** The lease an ordered trip to a new sector takes (a player's far trip). */
export function npcTravelMs(): number { return travelMs; }

function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

// --- Destinations ------------------------------------------------------------

export type NpcJourneyPurpose = 'gather' | 'shrine' | 'cairn' | 'stronghold' | 'rift' | 'gate' | 'bridge'
    | 'crossroads' | 'castle' | 'home' | 'hunt' | 'boss';
/** Destinations a journey picks for itself (errands are set by the presence tick). */
type SpotPurpose = Exclude<NpcJourneyPurpose, 'hunt' | 'boss'>;

export type NpcJourneySpot = { purpose: SpotPurpose; sector: number; tile: number; activity?: NpcGatherActivity; nodeId?: string };

/** What the NPC is doing there, said the way a profile would. */
export const NPC_JOURNEY_REASONS: Readonly<Record<NpcJourneyPurpose, string>> = Object.freeze({
    gather: 'gathering', shrine: 'praying at the shrine', cairn: 'reading the cairn', stronghold: 'scouting the stronghold',
    rift: 'watching the rift ground', gate: 'visiting a village gate', bridge: 'crossing the river', crossroads: 'watching the crossroads',
    castle: 'walking the castle streets', home: 'back home in Cinderhold', hunt: 'hunting a rival', boss: 'watching the world boss',
});

/**
 * How long it stays, in minutes (seeded inside the range per stop). Short
 * enough that a shinobi is seen setting off again every few minutes; a
 * gatherer and a visit home last longest.
 */
export const NPC_JOURNEY_DWELL_MINUTES: Readonly<Record<SpotPurpose, readonly [number, number]>> = Object.freeze({
    gather: [3, 6], shrine: [1.5, 4], cairn: [1, 2.5], stronghold: [1.5, 3], rift: [1.5, 3], gate: [2, 4],
    bridge: [1, 3], crossroads: [1, 2], castle: [2, 4], home: [3, 6],
});

/** Which kinds of place each personality heads for (relative weights). */
export const NPC_JOURNEY_WEIGHTS: Readonly<Record<NpcPersonality, Readonly<Partial<Record<SpotPurpose, number>>>>> = Object.freeze({
    aggressive: { stronghold: 4, crossroads: 4, rift: 3, gate: 2, gather: 1, castle: 1, home: 1.5, bridge: 1, shrine: 0.5, cairn: 0.5 },
    guardian: { gate: 4, crossroads: 3, stronghold: 2, home: 2, gather: 1.5, shrine: 1, castle: 1, bridge: 1, rift: 1, cairn: 0.5 },
    medic: { shrine: 4, gather: 3, bridge: 2, home: 2, cairn: 1.5, castle: 1, gate: 1, rift: 0.5, crossroads: 0.5, stronghold: 0.5 },
    trickster: { rift: 3, cairn: 2.5, castle: 2, gather: 2, bridge: 2, gate: 1.5, crossroads: 1, stronghold: 1, home: 1, shrine: 0.5 },
});

const CINDERHOLD = new Set(CINDERHOLD_SECTORS);
const CASTLE = new Set(CASTLE_SECTORS);
const OUTSKIRTS = new Set(OUTSKIRTS_SECTORS);

/** A walkable tile next to `tile` that is no gatherer's spot (a site's door is left clear), else the tile itself. */
function besideTile(sector: number, tile: number): number {
    const at = nearestWalkableTile(sector, tile);
    const around = tileNeighbors(at).filter((t) => isWalkableTile(sector, t) && !isNodeApproachTile(sector, t));
    return around[0] ?? npcStandTile(sector, at);
}

/** The walkable tile nearest the middle of a sector's road exits: where its roads meet. */
function junctionTile(sector: number): number {
    const exits = sectorExits(sector);
    const col = Math.round(exits.reduce((sum, e) => sum + (e.tile % SECTOR_GRID_WIDTH), 0) / exits.length);
    const row = Math.round(exits.reduce((sum, e) => sum + Math.floor(e.tile / SECTOR_GRID_WIDTH), 0) / exits.length);
    return npcStandTile(sector, nearestWalkableTile(sector, row * SECTOR_GRID_WIDTH + col));
}

/** Every place a journey can lead, over the whole roam ground (Cinderhold included). */
export const JOURNEY_SPOTS: readonly NpcJourneySpot[] = (() => {
    const out: NpcJourneySpot[] = [];
    const seen = new Set<string>();
    const add = (spot: NpcJourneySpot) => {
        const key = `${spot.sector}:${spot.tile}`;
        if (seen.has(key) || !isWalkableTile(spot.sector, spot.tile) || isNodeApproachTile(spot.sector, spot.tile)) return;
        seen.add(key);
        out.push(spot);
    };
    for (const sector of NPC_ROAM_SECTORS) {
        const home = CINDERHOLD.has(sector);
        const layout = SECTOR_FLOOR_LAYOUTS[sectorArtKey(sector)];
        const site = (purpose: SpotPurpose, tile: number) => add({ purpose: home ? 'home' : purpose, sector, tile: besideTile(sector, tile) });
        if (layout?.village) site(OUTSKIRTS.has(sector) ? 'gate' : 'home', layout.village.approach);
        if (layout?.sites.shrine) site('shrine', layout.sites.shrine.approach);
        if (layout?.sites.cairn) site('cairn', layout.sites.cairn.approach);
        if (layout?.sites.stronghold) site('stronghold', layout.sites.stronghold.approach);
        if (layout?.sites.rift) site(CASTLE.has(sector) ? 'castle' : 'rift', layout.sites.rift.approach);
        const bridges = layout?.hydrology?.bridgeTiles ?? [];
        if (bridges.length) site('bridge', bridges[Math.floor(bridges.length / 2)]!);
        if (sectorExits(sector).length >= 4) add({ purpose: home ? 'home' : CASTLE.has(sector) ? 'castle' : 'crossroads', sector, tile: junctionTile(sector) });
    }
    for (const node of NPC_GATHER_NODES) {
        const tile = npcNodeStandTiles(node)[0];
        if (tile !== undefined) add({ purpose: 'gather', sector: node.sector, tile, activity: node.activity, nodeId: node.id });
    }
    return out;
})();

const SPOTS_BY_PURPOSE: ReadonlyMap<SpotPurpose, readonly NpcJourneySpot[]> = (() => {
    const out = new Map<SpotPurpose, NpcJourneySpot[]>();
    for (const spot of JOURNEY_SPOTS) out.set(spot.purpose, [...(out.get(spot.purpose) ?? []), spot]);
    return out;
})();
const GATHER_NODE = new Map(NPC_GATHER_NODES.map((node) => [node.id, node]));

/** A meadow counts only while something grows there; mines and fishing spots always do. */
function spotOpen(spot: NpcJourneySpot, now: number): boolean {
    if (spot.activity !== 'harvesting' || !spot.nodeId) return true;
    return harvestBloom(GATHER_NODE.get(spot.nodeId) ?? { id: spot.nodeId }, now).present;
}

// --- Journey state -----------------------------------------------------------

export type NpcJourneyGoal = {
    purpose: NpcJourneyPurpose;
    sector: number;
    tile: number;
    reason: string;
    dwellMs: number;
    activity?: NpcGatherActivity;
    nodeId?: string;
    /** Set by the presence tick (a hunt, watching the boss): held until the tick clears it. */
    errand?: boolean;
};

type Journey = {
    id: string;
    name: string;
    personality: NpcPersonality;
    seed: number;
    leg: number;
    goal: NpcJourneyGoal;
    phase: 'walking' | 'dwelling';
    dwellUntil: number;
    /** Tiles still to walk in `pathSector`, then the road to `hop` (null: the goal is in this sector). */
    path: number[];
    pathSector: number;
    hop: number | null;
    planned: boolean;
    lastStepAt: number;
    /** Ground (tiles) earned but not yet walked. */
    budget: number;
    /** Why it is not walking itself right now (a war order or front, admin control, finishing a fight while due off). */
    held: string | null;
    /** Start a new leg at the next step (after an order, an errand, possession). */
    freshLeg: boolean;
    recent: number[];
    standKey: string | null;
    lookTiles: number[];
    lookIndex: number;
    lookAt: number;
    /** Where its row last stood: a journey whose row aged out (a long hold) comes back there, not at its goal. */
    lastAt?: { sector: number; tile: number };
};

const journeys = new Map<string, Journey>();
/** `${sector}:${tile}` -> the NPC standing there for a stop (two never share a tile). */
const standing = new Map<string, string>();
/** Where an NPC logged off (or 'home' after hospital), so it comes back there. */
const comeBack = new Map<string, { sector: number; tile: number }>();
let world: { fronts: ReadonlySet<number>; blocked: ReadonlySet<number> } = { fronts: new Set(), blocked: new Set() };

/** The presence tick's view of the world this tick: war fronts, and the boss's sector (only its watchers go there). */
export function setNpcJourneyWorld(fronts: readonly number[], bossSector: number | null): void {
    world = { fronts: new Set(fronts), blocked: new Set([...fronts, ...(bossSector === null ? [] : [bossSector])]) };
    // A stop that has just become a war front (or the boss's ground) is given up for another.
    for (const j of journeys.values()) if (!j.goal.errand && world.blocked.has(j.goal.sector)) j.freshLeg = true;
}

const standKey = (sector: number, tile: number) => `${sector}:${tile}`;
function unclaim(j: Journey): void {
    if (j.standKey && standing.get(j.standKey) === j.id) standing.delete(j.standKey);
    j.standKey = null;
}
function takenByOther(id: string, sector: number, tile: number): boolean {
    const holder = standing.get(standKey(sector, tile));
    return holder !== undefined && holder !== id;
}
/** `tile`, or the nearest walkable tile within two steps that no other NPC stands on (and no gatherer's spot). */
function freeTile(id: string, sector: number, tile: number, avoid: ReadonlySet<number> = new Set()): number {
    if (!takenByOther(id, sector, tile) && !avoid.has(tile)) return tile;
    const seen = new Set([tile]);
    let ring = [tile];
    for (let depth = 0; depth < 2; depth++) {
        const next: number[] = [];
        for (const at of ring) for (const t of tileNeighbors(at)) {
            if (seen.has(t)) continue;
            seen.add(t);
            if (!isWalkableTile(sector, t) || isNodeApproachTile(sector, t)) continue;
            if (!takenByOther(id, sector, t) && !avoid.has(t)) return t;
            next.push(t);
        }
        ring = next;
    }
    return tile;
}

function dwellFor(purpose: SpotPurpose, h: number): number {
    const [min, max] = NPC_JOURNEY_DWELL_MINUTES[purpose];
    const spanS = Math.round((max - min) * 60);
    return Math.round(min * MINUTE_MS + (h % (spanS + 1)) * 1000);
}

function goalAt(spot: NpcJourneySpot, id: string, dwellMs: number): NpcJourneyGoal {
    let tile = spot.tile;
    if (spot.nodeId) {
        // Any free tile beside the node's spot, never the spot itself.
        const node = GATHER_NODE.get(spot.nodeId);
        const options = node ? npcNodeStandTiles(node) : [spot.tile];
        tile = options.find((t) => !takenByOther(id, spot.sector, t)) ?? spot.tile;
    } else tile = freeTile(id, spot.sector, spot.tile);
    return {
        purpose: spot.purpose, sector: spot.sector, tile, reason: NPC_JOURNEY_REASONS[spot.purpose], dwellMs,
        ...(spot.activity ? { activity: spot.activity, nodeId: spot.nodeId } : {}),
    };
}

/**
 * The next stop for this NPC, leaving `from`: a kind of place by its
 * personality, then a place of that kind (seeded), never where it stands, a war
 * front, the boss's sector or one of its last three stops.
 */
export function npcJourneyPick(id: string, personality: NpcPersonality, seed: number, leg: number, from: number, now: number,
    recent: readonly number[] = [], blocked: ReadonlySet<number> = world.blocked): NpcJourneyGoal {
    const draw = (salt: string) => hash32(`${id}:${seed}:leg:${leg}:${salt}`);
    const skip = new Set(recent);
    const reachable = (spot: NpcJourneySpot) => spot.sector !== from && !blocked.has(spot.sector) && npcRoadDistance(from, spot.sector) !== null;
    const pools: Array<[SpotPurpose, NpcJourneySpot[], number]> = [];
    for (const [purpose, weight] of Object.entries(NPC_JOURNEY_WEIGHTS[personality]) as Array<[SpotPurpose, number]>) {
        const spots = (SPOTS_BY_PURPOSE.get(purpose) ?? []).filter((s) => reachable(s) && !skip.has(s.sector) && spotOpen(s, now));
        if (spots.length && weight > 0) pools.push([purpose, spots, weight]);
    }
    let pool: NpcJourneySpot[];
    if (pools.length) {
        const total = pools.reduce((sum, [, , w]) => sum + w, 0);
        let roll = (draw('kind') % 1_000_000) / 1_000_000 * total;
        let chosen = pools[pools.length - 1]!;
        for (const entry of pools) { roll -= entry[2]; if (roll < 0) { chosen = entry; break; } }
        pool = chosen[1];
    } else {
        pool = JOURNEY_SPOTS.filter(reachable);
    }
    if (!pool.length) {
        // Nowhere else to go (a sealed-off corner): it stays put for a while.
        const tile = nearestWalkableTile(from, 78);
        return { purpose: CINDERHOLD.has(from) ? 'home' : 'crossroads', sector: from, tile, reason: NPC_JOURNEY_REASONS.crossroads, dwellMs: 2 * MINUTE_MS };
    }
    // Near, middling or anywhere: most trips stay in the region, some cross the map.
    const reach = [4, 8, Infinity][draw('reach') % 3]!;
    const near = pool.filter((s) => (npcRoadDistance(from, s.sector) ?? Infinity) <= reach);
    const options = near.length ? near : pool;
    const spot = options[draw('place') % options.length]!;
    return goalAt(spot, id, dwellFor(spot.purpose, draw('dwell')));
}

/** A place in Cinderhold (a seeded one), where a shinobi back from hospital starts. */
function homeSpot(id: string, seed: number): NpcJourneySpot {
    const homes = SPOTS_BY_PURPOSE.get('home') ?? [];
    return homes[hash32(`${id}:home:${seed}`) % homes.length]!;
}

function newJourney(npc: Pick<NpcShinobi, 'id' | 'name' | 'personality'>, now: number): Journey {
    return {
        id: npc.id, name: npc.name, personality: npc.personality, seed: Math.floor(now / HOUR_MS), leg: 0,
        goal: { purpose: 'home', sector: CINDERHOLD_SECTORS[0]!, tile: 78, reason: NPC_JOURNEY_REASONS.home, dwellMs: 0 },
        phase: 'walking', dwellUntil: 0, path: [], pathSector: -1, hop: null, planned: false,
        lastStepAt: now, budget: 0, held: null, freshLeg: true, recent: [], standKey: null, lookTiles: [], lookIndex: 0, lookAt: 0,
    };
}

function settle(j: Journey, sector: number, tile: number, now: number, until: number): void {
    unclaim(j);
    j.phase = 'dwelling';
    j.dwellUntil = until;
    j.standKey = standKey(sector, tile);
    if (!takenByOther(j.id, sector, tile)) standing.set(j.standKey, j.id);
    j.recent = [...j.recent.filter((s) => s !== sector), sector].slice(-3);
    // A gatherer keeps to its node; anyone else looks about now and then (a step aside and back).
    const aside = j.goal.activity || j.goal.purpose === 'hunt' ? undefined
        : tileNeighbors(tile).find((t) => isWalkableTile(sector, t) && !isNodeApproachTile(sector, t) && !takenByOther(j.id, sector, t));
    j.lookTiles = aside === undefined ? [] : [tile, aside];
    j.lookIndex = 0;
    j.lookAt = now + 20_000 + (hash32(`${j.id}:look:${j.leg}`) % 25_000);
}

/**
 * The NPC's journey, created if it has none. Returns where it is: its presence
 * row if it has one (it carries on from there), else where it starts.
 */
export function ensureNpcJourney(npc: Pick<NpcShinobi, 'id' | 'name' | 'personality'>, now: number,
    row?: Pick<OnlinePlayer, 'sector' | 'tile'> | null): { sector: number; tile: number } {
    const known = journeys.get(npc.id);
    if (known && row) return { sector: row.sector, tile: row.tile ?? nearestWalkableTile(row.sector, 78) };
    // No row (it aged out under a long hold, an admin's say): back where it last stood.
    if (known) return known.lastAt ?? { sector: known.goal.sector, tile: known.goal.tile };
    const j = newJourney(npc, now);
    journeys.set(npc.id, j);
    const back = comeBack.get(npc.id);
    comeBack.delete(npc.id);
    // Already on the map, or back where it left: it sets off from there.
    const from = row ? { sector: row.sector, tile: row.tile ?? nearestWalkableTile(row.sector, 78) } : back;
    if (from) { startLeg(j, from.sector, now); return from; }
    // A fresh start (a restart, or first time out): part-way through a stop
    // somewhere in the world, seeded per NPC and hour.
    const open = JOURNEY_SPOTS.filter((s) => !world.blocked.has(s.sector) && spotOpen(s, now));
    const spot = (open.length ? open : JOURNEY_SPOTS)[hash32(`${npc.id}:start:${j.seed}`) % (open.length || JOURNEY_SPOTS.length)]!;
    const dwellMs = dwellFor(spot.purpose, hash32(`${npc.id}:start-dwell:${j.seed}`));
    j.goal = goalAt(spot, npc.id, dwellMs);
    j.freshLeg = false;
    settle(j, j.goal.sector, j.goal.tile, now, now + (hash32(`${npc.id}:start-left:${j.seed}`) % (dwellMs + 1)));
    return { sector: j.goal.sector, tile: j.goal.tile };
}

/** The tick has the NPC on a war order or front, under admin control, or finishing a fight while due off the map. */
export function holdNpcJourney(id: string, reason: string): void {
    const j = journeys.get(id);
    if (!j || j.held === reason) return;
    j.held = reason;
    unclaim(j);
}
/** Free to walk again: it starts a new leg from wherever the hold left it. */
export function releaseNpcJourney(id: string, now: number): void {
    const j = journeys.get(id);
    if (!j?.held) return;
    j.held = null;
    j.freshLeg = true;
    j.lastStepAt = now;
}

/** Points the journey at an errand (a hunt, the world boss), or clears one. Stays there until cleared. */
export function setNpcJourneyErrand(id: string, errand: { purpose: 'hunt' | 'boss'; sector: number; tile: number } | null): void {
    const j = journeys.get(id);
    if (!j) return;
    if (!errand) {
        if (j.goal.errand) j.freshLeg = true;
        return;
    }
    if (j.goal.errand && j.goal.purpose === errand.purpose && j.goal.sector === errand.sector) return;
    unclaim(j);
    j.goal = { ...errand, reason: NPC_JOURNEY_REASONS[errand.purpose], dwellMs: Infinity, errand: true };
    j.phase = 'walking';
    j.planned = false;
    j.freshLeg = false;
}

/** Off the map (off duty, wounded, gone): the journey ends. `comeBackAt` is where it reappears. */
export function dropNpcJourney(id: string, comeBackAt?: { sector: number; tile: number } | 'home' | null): void {
    const j = journeys.get(id);
    if (j) unclaim(j);
    journeys.delete(id);
    if (comeBackAt === 'home') {
        const spot = homeSpot(id, Math.floor(Date.now() / HOUR_MS));
        comeBack.set(id, { sector: spot.sector, tile: spot.tile });
    } else if (comeBackAt) comeBack.set(id, comeBackAt);
}

export type NpcJourneyView = {
    purpose: NpcJourneyPurpose; reason: string; sector: number; tile: number;
    phase: 'walking' | 'dwelling'; dwellUntil: number; leg: number; held: string | null; activity?: NpcGatherActivity;
};
/** Where the NPC is going and why (tests, admin), or null when it is on no journey. */
export function npcJourneyOf(id: string): NpcJourneyView | null {
    const j = journeys.get(id);
    if (!j) return null;
    return {
        purpose: j.goal.purpose, reason: j.goal.reason, sector: j.goal.sector, tile: j.goal.tile, phase: j.phase,
        dwellUntil: j.dwellUntil, leg: j.leg, held: j.held, ...(j.goal.activity ? { activity: j.goal.activity } : {}),
    };
}
export function npcJourneyIds(): string[] { return [...journeys.keys()]; }

/** Shows the gathering pose exactly while it is stopped at a gathering node, and clears it otherwise. */
export function syncNpcJourneyActivity(id: string, row: OnlinePlayer | null = null): void {
    const j = journeys.get(id);
    const current = row ?? (j ? onlineStore.get(j.name) : null);
    if (!j || !current) return;
    const want = !j.held && j.phase === 'dwelling' && current.sector === j.goal.sector ? j.goal.activity : undefined;
    if (current.activity === want) return;
    onlineStore.setActivity(j.name, want);
    queuePresenceUpdate(current.name, current.sector);
}

/** Tests: put a journey at a chosen stop, dwelling there from `now` for its goal's dwell. */
export function settleNpcJourneyForTest(id: string, goal: NpcJourneyGoal, now: number): void {
    const j = journeys.get(id);
    if (!j) return;
    j.goal = goal; j.freshLeg = false;
    settle(j, goal.sector, goal.tile, now, now + goal.dwellMs);
}

export function resetNpcJourneysForTest(): void { journeys.clear(); standing.clear(); comeBack.clear(); world = { fronts: new Set(), blocked: new Set() }; }

// --- The walker ----------------------------------------------------------------

function startLeg(j: Journey, from: number, now: number): void {
    unclaim(j);
    j.leg++;
    j.goal = npcJourneyPick(j.id, j.personality, j.seed, j.leg, from, now, j.recent);
    j.phase = 'walking';
    j.planned = false;
    j.path = [];
    j.hop = null;
    j.freshLeg = false;
}

/** The tiles from where it stands to the next exit (or to its goal tile, in the goal's sector). False: no road leads on. */
function plan(j: Journey, row: OnlinePlayer): boolean {
    const sector = row.sector;
    const obstacles = sectorObstaclesEnabled();
    const from = nearestWalkableTile(sector, row.tile ?? 78, obstacles);
    let target: number;
    let hop: number | null = null;
    if (sector === j.goal.sector) target = j.goal.tile;
    else {
        hop = npcRoadNextHop(sector, j.goal.sector, world.fronts);
        const exit = hop === null ? undefined : sectorExits(sector).find((e) => e.destinationSector === hop);
        if (!exit) return false;
        target = exit.tile;
    }
    target = nearestWalkableTile(sector, target, obstacles);
    const path = walkPath(sector, from, target, obstacles) ?? [from, target];
    j.path = path.slice(1);
    j.pathSector = sector;
    j.hop = hop;
    j.planned = true;
    return true;
}

/**
 * Tell the sector about a step the way it hears a walking player: the tile
 * delta, plus the world-position delta a player's accepted world move sends
 * (world-movement-service.ts). The continuous world's peer layer follows the
 * world delta's sequence; with the tile delta alone it kept the position from
 * its last two-second nearby poll, so a walking NPC stood still on screen and
 * then vanished at the border. The row keeps no worldPosition: that field
 * marks a cursor someone else drives (an admin's client).
 */
export function announceNpcStep(moved: OnlinePlayer, tile: number): void {
    const sequence = moved.movementSeq ?? 0;
    pushTileMovement(moved.sector, moved.displayName, tile, sequence);
    const position = worldPositionModel().fallback(moved.sector, tile);
    if (position) pushWorldMovement(moved.sector, moved.displayName, tile, sequence, position);
}

export type NpcWalkReport = { journeys: number; walking: number; moves: number; tiles: number; crossed: number; arrived: number };

function stepOne(j: Journey, now: number, report: NpcWalkReport): void {
    const elapsed = Math.max(0, Math.min(NPC_WALK_MAX_CATCHUP_MS, now - j.lastStepAt));
    j.lastStepAt = now;
    let row = onlineStore.get(j.name);
    if (row) j.lastAt = { sector: row.sector, tile: row.tile ?? nearestWalkableTile(row.sector, 78) };
    if (j.held) return;
    // Off the map (the tick places it), or someone else is driving it (an admin's client owns a cursor).
    if (!row || row.worldPosition) return;
    // Unless attacked: an attack, a fight opening on it or a fight pins it where
    // it stands (api/_npc-attack-hold.ts bridges the seconds before its seat joins).
    if (row.inBattle || row.pendingAttacker != null || npcPinned(j.id, Date.now())
        || Number(row.travelingUntil) > onlineStore.clockNow()) { j.budget = 0; return; }
    if (j.freshLeg) startLeg(j, row.sector, now);
    if (j.phase === 'dwelling') {
        j.budget = 0;
        // A meadow that stops blooming has nothing left to cut: it moves on, as a player would.
        if (j.goal.activity === 'harvesting' && j.goal.nodeId && !harvestBloom(GATHER_NODE.get(j.goal.nodeId) ?? { id: j.goal.nodeId }, now).present) j.dwellUntil = Math.min(j.dwellUntil, now);
        if (now < j.dwellUntil) {
            if (j.lookTiles.length > 1 && now >= j.lookAt) {
                j.lookIndex++;
                j.lookAt = now + 20_000 + (hash32(`${j.id}:look:${j.leg}:${j.lookIndex}`) % 25_000);
                const tile = j.lookTiles[j.lookIndex % j.lookTiles.length]!;
                const moved = tile !== row.tile && !takenByOther(j.id, row.sector, tile) ? onlineStore.moveToTile(j.name, tile) : null;
                if (moved) {
                    // Its claim follows it, so nobody arriving takes the tile it stands on.
                    unclaim(j);
                    j.standKey = standKey(moved.sector, tile);
                    standing.set(j.standKey, j.id);
                    announceNpcStep(moved, tile);
                    report.moves++; report.tiles++;
                }
            }
            syncNpcJourneyActivity(j.id, row);
            return;
        }
        startLeg(j, row.sector, now);
    }
    syncNpcJourneyActivity(j.id, row);
    report.walking++;
    const pace = process.env.ENABLE_SECTOR_MODEL_DISPLAY === '1' && process.env.ENABLE_PLAYER_GAIT_PILOT === '1'
        && process.env.R2_PUBLIC_BASE?.trim() ? sectorGaitTilesPerSecond.walk : NPC_WALK_TILES_PER_SECOND;
    const cap = pace * NPC_WALK_MAX_CATCHUP_MS / 1000;
    j.budget = Math.min(cap, j.budget + elapsed / 1000 * pace);
    for (let guard = 0; guard < 16; guard++) {
        if (!j.planned || j.pathSector !== row.sector) {
            if (!plan(j, row)) {
                // No road on toward it: an errand waits where it is; a stop of its own is re-chosen from here.
                if (j.goal.errand) { j.budget = 0; return; }
                startLeg(j, row.sector, now);
                if (!plan(j, row)) { j.budget = 0; return; }
            }
        }
        if (j.path.length) {
            const take = Math.min(Math.floor(j.budget), j.path.length);
            if (take < 1) return;
            const tile = j.path[take - 1]!;
            const moved = onlineStore.moveToTile(j.name, tile);
            if (!moved) { j.planned = false; j.budget = 0; return; }
            j.path = j.path.slice(take);
            j.budget -= take;
            announceNpcStep(moved, tile);
            report.moves++;
            report.tiles += take;
            row = moved;
            if (j.path.length) return;
        }
        if (j.hop !== null) {
            // At the road's exit: over the border at once, as a walking player crosses,
            // landing on the road's arrival tile and walking straight on from it.
            const origin = row.sector, hop = j.hop;
            const arrival = npcStandTile(hop, travelArrivalTile(origin, hop) ?? nearestWalkableTile(hop, 78));
            const crossed = onlineStore.startTravel(j.name, hop, onlineStore.clockNow(), origin, arrival);
            if (!crossed) { j.budget = 0; j.planned = false; return; }
            report.crossed++;
            j.planned = false;
            j.hop = null;
            const landed = onlineStore.get(j.name);
            if (!landed || landed.sector !== hop) { j.budget = 0; return; }
            // The store's move event already told both sectors; this carries the new row.
            queuePresenceUpdate(landed.name, landed.sector);
            row = landed;
            continue;
        }
        // There. Two never stand on one tile: a step aside if someone already does.
        const tile = freeTile(j.id, row.sector, row.tile ?? j.goal.tile);
        if (tile !== row.tile) {
            const moved = onlineStore.moveToTile(j.name, tile);
            if (moved) { announceNpcStep(moved, tile); report.moves++; report.tiles++; row = moved; }
        }
        settle(j, row.sector, row.tile ?? tile, now, j.goal.errand ? Infinity : now + j.goal.dwellMs);
        j.budget = 0;
        report.arrived++;
        syncNpcJourneyActivity(j.id, row);
        return;
    }
}

let stepping = false;
/**
 * One walker step: every journey advances by the ground its elapsed time
 * covers. Synchronous and in memory only (no storage read or write).
 */
export function stepNpcJourneys(now = Date.now()): NpcWalkReport {
    const report: NpcWalkReport = { journeys: journeys.size, walking: 0, moves: 0, tiles: 0, crossed: 0, arrived: 0 };
    if (stepping) return report;
    stepping = true;
    try { for (const j of journeys.values()) stepOne(j, now, report); }
    finally { stepping = false; }
    return report;
}
