import { sectorExits } from "../../../shared/sector-links";
import { sectorFloorLayout } from "./sector-floor-layout";
import { WORLD_BOSS_EVENT_HOP_MS } from "../../../shared/world-boss-event";
import { tileSpan, worldBossGround, worldBossSectorTile, worldBossTileToward, type WorldBossGround } from "./world-boss-sector-placement";

const GRID = 12;
/** A heavy, deliberate march, a quarter of the Weekly Boss's stalk. */
export const WORLD_BOSS_PATROL_TILES_PER_SEC = 1.1;
/** At the exit it stands looking the way it is headed before it turns back. */
export const WORLD_BOSS_PATROL_EXIT_HOLD_MS = 3_500;
/** At the entry end it only turns around. */
export const WORLD_BOSS_PATROL_ENTRY_HOLD_MS = 1_200;
/** Ends closer than this leave too short a walk to read as a patrol. */
const MIN_PATROL_TILES = 2.5;

export type WorldBossPatrolPose = Readonly<{ col: number; row: number; walking: boolean; facing: -1 | 1 }>;

type Leg = Readonly<{ from: number; to: number; startMs: number; endMs: number; walking: boolean; facing: -1 | 1 }>;

export type WorldBossPatrol = Readonly<{
    /** Waypoints from the entry end to the exit end. Straight lines between them stay on walkable ground. */
    waypoints: readonly number[];
    /** Where it stands when it does not walk: its usual spot, or the only spot a cramped sector has. */
    restTile: number;
    restFacing: -1 | 1;
    /** 0 when it stands still. */
    cycleMs: number;
    /** Web Animations keyframes in tile units over one cycle. */
    frames: readonly Readonly<{ col: number; row: number; offset: number }>[];
    poseAt: (ms: number) => WorldBossPatrolPose;
    /** Milliseconds from `ms` until it next starts, stops or turns. */
    untilChange: (ms: number) => number;
    footprint: (tile: number) => number[];
}>;

const colOf = (tile: number) => tile % GRID;
const rowOf = (tile: number) => Math.floor(tile / GRID);
const distance = (a: number, b: number) => tileSpan(colOf(a) - colOf(b), rowOf(a) - rowOf(b));

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** The cheapest king's-move walk from `from` to `to` over `pass`, where each
 *  tile entered costs its step plus `penalty`. A diagonal needs both tiles it
 *  cuts between, so the figure never clips a wall's corner. */
function cheapestPath(from: number, to: number, pass: (tile: number) => boolean, penalty: (tile: number) => number): number[] | null {
    const ok = (tile: number) => tile === from || tile === to || pass(tile);
    const cost = new Map<number, number>([[from, 0]]);
    const parent = new Map<number, number>([[from, from]]);
    const done = new Set<number>();
    for (;;) {
        let tile = -1;
        for (const [candidate, spent] of cost) {
            if (!done.has(candidate) && (tile < 0 || spent < cost.get(tile)! || (spent === cost.get(tile)! && candidate < tile))) tile = candidate;
        }
        if (tile < 0) return null;
        if (tile === to) break;
        done.add(tile);
        const col = colOf(tile), row = rowOf(tile);
        for (const [dc, dr] of STEPS) {
            const c = col + dc, r = row + dr, next = r * GRID + c;
            if (c < 0 || c >= GRID || r < 0 || r >= GRID || done.has(next) || !ok(next)) continue;
            if (dc && dr && (!ok(row * GRID + c) || !ok(r * GRID + col))) continue;
            const spent = cost.get(tile)! + tileSpan(dc, dr) + penalty(next);
            if (spent < (cost.get(next) ?? Infinity)) { cost.set(next, spent); parent.set(next, tile); }
        }
    }
    const path = [to];
    while (path[0] !== from) path.unshift(parent.get(path[0]!)!);
    return path;
}

const NUDGES = [[0, 0], [0.12, 0.12], [0.12, -0.12], [-0.12, 0.12], [-0.12, -0.12]] as const;

/** Every tile the straight line between two tile centres passes over. */
export function tilesAlong(a: number, b: number): number[] {
    const steps = Math.max(1, Math.ceil(distance(a, b) * 4));
    const tiles = new Set<number>();
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        // Sample a hair around the line too, so a line passing a tile's edge
        // or corner counts every tile it brushes.
        for (const [nc, nr] of NUDGES) {
            const col = Math.round(colOf(a) + (colOf(b) - colOf(a)) * t + nc);
            const row = Math.round(rowOf(a) + (rowOf(b) - rowOf(a)) * t + nr);
            if (col >= 0 && col < GRID && row >= 0 && row < GRID) tiles.add(row * GRID + col);
        }
    }
    return [...tiles];
}

/** Drop the waypoints a straight walk can skip, so it strides instead of
 *  zigzagging tile to tile. A shortcut may not cross a tile worse than the
 *  worst one on the stretch of path it replaces. */
function straighten(path: readonly number[], pass: (tile: number) => boolean, penalty: (tile: number) => number): number[] {
    const out = [path[0]!];
    let at = 0;
    while (at < path.length - 1) {
        let far = at + 1;
        for (let next = path.length - 1; next > at + 1; next -= 1) {
            const worst = Math.max(...path.slice(at, next + 1).map(penalty));
            if (tilesAlong(path[at]!, path[next]!).every(tile => tile === path[at] || tile === path[next] || (pass(tile) && penalty(tile) <= worst))) { far = next; break; }
        }
        out.push(path[far]!);
        at = far;
    }
    return out;
}

/** Above this row a figure three tiles tall can leave the top of a camera that
 *  follows a player standing lower down (at 1366x768, a player at the Ashen
 *  Leaf gate on row 8 sees rows 2.5 and below), so the walk prefers the middle. */
const HIGH_ROW = 5;

function routeBetween(ground: WorldBossGround, from: number, to: number, grounds: readonly ((tile: number) => boolean)[]): number[] | null {
    const penalty = (tile: number) => (ground.roomy(tile) ? 0 : 0.6) + (ground.clear(tile) ? 0 : 0.8)
        + Math.max(0, HIGH_ROW - rowOf(tile)) * 0.7;
    for (const pass of grounds) {
        const path = cheapestPath(from, to, pass, penalty);
        if (path) return straighten(path, tile => tile === from || tile === to || pass(tile), penalty);
    }
    return null;
}

/** Every tile a walk over `pass` reaches from `start`. */
function reachableFrom(start: number, pass: (tile: number) => boolean): Set<number> {
    const seen = new Set([start]), queue = [start];
    for (let i = 0; i < queue.length; i += 1) {
        const tile = queue[i]!, col = colOf(tile), row = rowOf(tile);
        for (const [dc, dr] of STEPS) {
            const c = col + dc, r = row + dr, next = r * GRID + c;
            if (c < 0 || c >= GRID || r < 0 || r >= GRID || seen.has(next) || !pass(next)) continue;
            if (dc && dr && (!pass(row * GRID + c) || !pass(r * GRID + col))) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return seen;
}

function timeline(waypoints: readonly number[], exitFacing: -1 | 0 | 1, restFacing: -1 | 1) {
    const legs: Leg[] = [];
    let clock = 0, facing: -1 | 1 = restFacing;
    const walk = (from: number, to: number) => {
        const dx = colOf(to) - colOf(from);
        if (dx) facing = dx < 0 ? -1 : 1;
        const ms = distance(from, to) / WORLD_BOSS_PATROL_TILES_PER_SEC * 1000;
        legs.push({ from, to, startMs: clock, endMs: clock + ms, walking: true, facing });
        clock += ms;
    };
    const hold = (tile: number, ms: number, face: -1 | 1) => {
        facing = face;
        legs.push({ from: tile, to: tile, startMs: clock, endMs: clock + ms, walking: false, facing });
        clock += ms;
    };
    for (let i = 1; i < waypoints.length; i += 1) walk(waypoints[i - 1]!, waypoints[i]!);
    const firstFacing = legs[0]!.facing;
    hold(waypoints.at(-1)!, WORLD_BOSS_PATROL_EXIT_HOLD_MS, exitFacing || facing);
    for (let i = waypoints.length - 1; i > 0; i -= 1) walk(waypoints[i]!, waypoints[i - 1]!);
    // It turns to face the exit again before it sets off.
    hold(waypoints[0]!, WORLD_BOSS_PATROL_ENTRY_HOLD_MS, firstFacing);
    return { legs, cycleMs: clock };
}

function exitToward(sector: number, destination: number | null | undefined) {
    if (destination == null || destination === sector) return null;
    return sectorExits(sector).find(exit => exit.destinationSector === destination) ?? null;
}

/**
 * The roaming world boss's walk inside its current sector. It patrols the
 * ground between the road it came in by and the road it will leave by toward
 * the village it attacks: it marches to that exit, stands there facing the way
 * it is headed, turns back to the entry end, and repeats. In the village's own
 * gate sector it marches on the gate itself. On its spawn hop it starts from
 * its usual spot, or from across the board when that spot is already by the
 * exit. The route and timing are deterministic, so with the server's clock
 * every player sees it at the same point.
 */
export function worldBossPatrol(
    sector: number,
    fromSector: number | null | undefined,
    toSector: number | null | undefined,
    isWalkable: (tile: number) => boolean,
): WorldBossPatrol {
    const ground = worldBossGround(sector, isWalkable);
    const home = worldBossSectorTile(sector, isWalkable);
    const exit = exitToward(sector, toSector);
    const gate = !exit && toSector === sector ? sectorFloorLayout(sector)?.village?.approach : undefined;
    const target = exit?.tile ?? gate;
    const end = target === undefined ? home : worldBossTileToward(ground, target);
    const exitFacing: -1 | 0 | 1 = exit
        ? exit.direction === "east" ? 1 : exit.direction === "west" ? -1 : 0
        : gate === undefined ? 0 : Math.sign(colOf(gate) - colOf(end)) as -1 | 0 | 1;
    const entry = exitToward(sector, fromSector);
    // From the road it came in by; failing that (its spawn hop, or a road on
    // the same side as the exit), its usual spot, then the best ground across
    // the board, then the ground nearest across the board that a walk with its
    // head on the board still connects to the exit end. A start where it would
    // cover a road exit's tile comes last, and a route over the top rows, where
    // its head leaves the board, is taken only when no start has another.
    const far = target ?? end, across = (GRID - 1 - rowOf(far)) * GRID + (GRID - 1 - colOf(far));
    const connected = reachableFrom(end, ground.standable);
    const candidates = [
        ...(entry ? [worldBossTileToward(ground, entry.tile)] : []),
        home,
        worldBossTileToward(ground, across),
        worldBossTileToward(ground, across, tile => connected.has(tile)),
    ];
    const starts = [...candidates.filter(ground.clearOfExits), ...candidates.filter(start => !ground.clearOfExits(start))];
    let waypoints: number[] = [end];
    search: for (const grounds of [[ground.standable], [ground.standable, ground.walkable]]) {
        for (const start of starts) {
            if (distance(start, end) < MIN_PATROL_TILES) continue;
            const route = routeBetween(ground, start, end, grounds);
            if (route) { waypoints = route; break search; }
        }
    }
    const restFacing: -1 | 1 = exitFacing || (colOf(end) < colOf(home) ? -1 : 1);
    const still = waypoints.length < 2;
    const { legs, cycleMs } = still ? { legs: [] as Leg[], cycleMs: 0 } : timeline(waypoints, exitFacing, restFacing);
    const restTile = still ? end : home;
    const legAt = (ms: number) => {
        const t = ((ms % cycleMs) + cycleMs) % cycleMs;
        return { t, leg: legs.find(leg => t < leg.endMs) ?? legs.at(-1)! };
    };
    return {
        waypoints,
        restTile,
        restFacing,
        cycleMs,
        frames: still ? [{ col: colOf(end), row: rowOf(end), offset: 0 }] : [
            ...legs.map(leg => ({ col: colOf(leg.from), row: rowOf(leg.from), offset: leg.startMs / cycleMs })),
            { col: colOf(waypoints[0]!), row: rowOf(waypoints[0]!), offset: 1 },
        ],
        poseAt: ms => {
            if (still) return { col: colOf(end), row: rowOf(end), walking: false, facing: restFacing };
            const { t, leg } = legAt(ms);
            const k = leg.endMs > leg.startMs ? Math.min(1, Math.max(0, (t - leg.startMs) / (leg.endMs - leg.startMs))) : 1;
            return {
                col: colOf(leg.from) + (colOf(leg.to) - colOf(leg.from)) * k,
                row: rowOf(leg.from) + (rowOf(leg.to) - rowOf(leg.from)) * k,
                walking: leg.walking,
                facing: leg.facing,
            };
        },
        untilChange: ms => {
            if (still) return Infinity;
            const { t, leg } = legAt(ms);
            return Math.max(0, leg.endMs - t);
        },
        footprint: ground.footprint,
    };
}

/** What the last event read said about the boss's clock. */
export type WorldBossPatrolClock = Readonly<{
    /** The server's clock when it answered. */
    serverNow: number;
    /** Time left in this hop; 0 once it no longer moves between sectors. */
    nextHopInMs: number;
    /** A team is forming, which freezes the hop. */
    paused: boolean;
}>;

/**
 * How far into its patrol the boss is at server time `now`. While it still
 * moves between sectors the patrol runs on its hop's own clock, the time
 * spent in this sector with every team-forming pause left out, so every
 * player's boss stops and walks on from the same point. At the village gate
 * it no longer hops, nothing pauses it, and the server's clock alone serves.
 */
export function worldBossPatrolElapsed(clock: WorldBossPatrolClock, now: number): number {
    if (clock.nextHopInMs <= 0) return now;
    const inSector = WORLD_BOSS_EVENT_HOP_MS - clock.nextHopInMs;
    return clock.paused ? inSector : inSector + Math.max(0, now - clock.serverNow);
}