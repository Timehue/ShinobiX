import { SECTOR_POINTS, SECTOR_ROAD_PAIRS } from './sector-links.js';
import { isPlayableWildSector, VILLAGE_OUTSKIRTS } from './sector-geo.js';

export const WORLD_BOSS_EVENT_DURATION_MS = 72 * 60 * 60 * 1000;
export const WORLD_BOSS_EVENT_ROAM_MS = 48 * 60 * 60 * 1000;
export const WORLD_BOSS_EVENT_HOP_MS = 13 * 60 * 1000;
export const WORLD_BOSS_EVENT_QUEUE_MS = 30 * 1000;
/** Prevent queue cancel/rejoin cycling from granting repeated PvP immunity. */
export const WORLD_BOSS_QUEUE_REJOIN_COOLDOWN_MS = 2 * 60 * 1000;
export const WORLD_BOSS_EVENT_MAX_PARTY = 3;
export const WORLD_BOSS_ASHFALL_MS = 24 * 60 * 60 * 1000;
export const WORLD_BOSS_CRYSTAL_MAX_NODES = 60;
export const WORLD_BOSS_HOLLOW_SHARDS_PER_TIER = 6;
export const WORLD_BOSS_HOLLOW_SHARD_POINTS = 1_000;
export const WORLD_BOSS_MAX_WEAKENING_TIERS = 10;
export const WORLD_BOSS_WEAKENING_PER_TIER = 0.05;
export const WORLD_BOSS_TOP_CACHE_SETTLEMENT_GRACE_MS = 6 * 60 * 60 * 1000;

export type WorldBossEventStatus = 'roaming' | 'final-stand' | 'victory' | 'retreated' | 'stopped';

export const WORLD_BOSS_DEFINITIONS = [
    {
        id: 'hollow-beast',
        name: 'Chicxulub',
        roleLabel: 'WORLD THREAT',
        keyArt: '/world-boss/hollow-beast-key-art-v1.webp',
        mapSprite: '/world-boss/hollow-beast-walk-v1.webp',
        mapSpriteKind: 'walk-sheet',
        mapGlow: 'teal',
        traitName: 'Hollow Regrowth',
        traitDescription: 'Regains health at the end of each round. Keep steady pressure on it.',
        combatTrait: 'regen',
    },
    {
        id: 'hollow-gate-bull',
        name: 'Murogane',
        roleLabel: 'HOLLOW GATE GUARDIAN',
        keyArt: '/world-boss/hollow-gate-bull-key-art-v1.webp',
        mapSprite: '/world-boss/hollow-gate-bull-walk-v1.webp',
        mapSpriteKind: 'walk-sheet',
        mapGlow: 'teal',
        traitName: 'Gatekeeper’s Bulwark',
        traitDescription: 'Takes half damage while any of its guards remain. Clear the guards to expose it.',
        combatTrait: 'bulwark',
    },
    {
        id: 'hollow-maze-minotaur',
        name: 'Donkaku',
        roleLabel: 'HOLLOW MAZE WARDEN',
        keyArt: '/world-boss/donkaku-key-art-v1.webp',
        mapSprite: '/world-boss/donkaku-walk-v1.webp',
        mapSpriteKind: 'walk-sheet',
        mapGlow: 'white-red',
        traitName: 'Hollow Gate Aegis',
        traitDescription: 'Raises a fresh shield at each health phase, up to a quarter of its health.',
        combatTrait: 'aegis',
    },
] as const;

export type WorldBossId = typeof WORLD_BOSS_DEFINITIONS[number]['id'];
export type WorldBossDefinition = typeof WORLD_BOSS_DEFINITIONS[number];

export function worldBossDefinition(bossId: string | null | undefined): WorldBossDefinition {
    return WORLD_BOSS_DEFINITIONS.find(boss => boss.id === bossId) ?? WORLD_BOSS_DEFINITIONS[0];
}

export type WorldBossContribution = {
    actions: number;
    damage: number;
    healing: number;
    shielding: number;
    cleanses: number;
    objective: number;
};

export type WorldBossEventPosition = {
    active: boolean;
    currentSector: number;
    nextSector: number;
    hopIndex: number;
    nextHopInMs: number;
    hopIntervalMs: number;
    movementPaused: boolean;
    targetSector: number | null;
    destinationReached: boolean;
};

export type WorldBossRoamInput = {
    eventId: string;
    startedAt: number;
    roamEndsAt: number;
    endsAt: number;
    movementPausedAt?: number | null;
    movementPausedTotalMs?: number;
    /** Missing only on legacy event records created before admin-selected routes. */
    spawnSector?: number;
    targetVillage?: string;
};

const ROAD_NEIGHBORS = (() => {
    const neighbors = new Map<number, number[]>();
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        if (!isPlayableWildSector(a) || !isPlayableWildSector(b)) continue;
        neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
        neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
    }
    for (const [sector, adjacent] of neighbors) neighbors.set(sector, adjacent.sort((a, b) => a - b));
    return neighbors;
})();

function shortestRoadRoute(spawnSector: number, targetSector: number): number[] | null {
    if (!isPlayableWildSector(spawnSector) || !isPlayableWildSector(targetSector)) return null;

    const queue = [spawnSector];
    const previous = new Map<number, number | null>([[spawnSector, null]]);
    for (let index = 0; index < queue.length && !previous.has(targetSector); index += 1) {
        const current = queue[index]!;
        for (const next of ROAD_NEIGHBORS.get(current) ?? []) {
            if (previous.has(next)) continue;
            previous.set(next, current);
            queue.push(next);
            if (next === targetSector) break;
        }
    }
    if (!previous.has(targetSector)) return null;

    const route = [targetSector];
    let cursor = targetSector;
    while (cursor !== spawnSector) {
        const parent = previous.get(cursor);
        if (parent == null) return null;
        route.push(parent);
        cursor = parent;
    }
    return route.reverse();
}

/** Return the shortest route over actual roads, for validation and route-distance checks. */
export function worldBossRoute(spawnSector: number, targetVillage: string): number[] | null {
    const targetSector = VILLAGE_OUTSKIRTS[targetVillage];
    if (!Number.isInteger(spawnSector) || !Number.isInteger(targetSector)) return null;
    return shortestRoadRoute(spawnSector, targetSector);
}

export function worldBossCrystalEffects(depositedShardCount: number) {
    const count = Math.max(0, Math.min(WORLD_BOSS_CRYSTAL_MAX_NODES, Math.floor(Number(depositedShardCount) || 0)));
    const filledTiers = Math.min(WORLD_BOSS_MAX_WEAKENING_TIERS, Math.floor(count / WORLD_BOSS_HOLLOW_SHARDS_PER_TIER));
    const tierProgressShards = filledTiers >= WORLD_BOSS_MAX_WEAKENING_TIERS ? 0 : count % WORLD_BOSS_HOLLOW_SHARDS_PER_TIER;
    const shardsToNextTier = filledTiers >= WORLD_BOSS_MAX_WEAKENING_TIERS ? 0 : WORLD_BOSS_HOLLOW_SHARDS_PER_TIER - tierProgressShards;
    const weakening = filledTiers * WORLD_BOSS_WEAKENING_PER_TIER;
    return {
        depositedHollowShards: count,
        filledTiers,
        maxTiers: WORLD_BOSS_MAX_WEAKENING_TIERS,
        tierProgressShards,
        shardsPerTier: WORLD_BOSS_HOLLOW_SHARDS_PER_TIER,
        shardsToNextTier,
        bossDamageDealtMultiplier: 1 - weakening,
        bossDamageReceivedMultiplier: 1 + weakening,
        damageDealtReductionPct: weakening * 100,
        damageReceivedBonusPct: weakening * 100,
    };
}

/** Choose the village nearest to a world sector, for the event's threatened-front display. */
export function worldBossThreatenedVillage(sector: number): string {
    const point = SECTOR_POINTS.find(entry => entry.id === sector);
    if (!point) return Object.keys(VILLAGE_OUTSKIRTS)[0] ?? 'Stormveil Village';
    return Object.entries(VILLAGE_OUTSKIRTS)
        .map(([village, gateSector]) => {
            const gate = SECTOR_POINTS.find(entry => entry.id === gateSector);
            return { village, distance: gate ? (point.x - gate.x) ** 2 + (point.y - gate.y) ** 2 : Infinity };
        })
        .sort((a, b) => a.distance - b.distance || a.village.localeCompare(b.village))[0]?.village
        ?? 'Stormveil Village';
}

function hash32(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function hopRandom(seed: number, hop: number): number {
    let x = (seed ^ Math.imul(hop + 1, 0x9e3779b1)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
}

function shortestDistancesTo(targetSector: number): Map<number, number> {
    const distances = new Map<number, number>([[targetSector, 0]]);
    const queue = [targetSector];
    for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]!;
        for (const next of ROAD_NEIGHBORS.get(current) ?? []) {
            if (distances.has(next)) continue;
            distances.set(next, distances.get(current)! + 1);
            queue.push(next);
        }
    }
    return distances;
}

const EVENT_ROUTE_CACHE_LIMIT = 64;
const eventRouteCache = new Map<string, readonly number[]>();

/**
 * Build a deterministic, road-connected roaming itinerary that stays in the
 * world for the full roam window and reaches the selected village gate on its
 * final hop. The walk explores broadly early, then increasingly favors roads
 * that close distance to the destination. It never visits the gate early.
 */
export function worldBossEventRoute(
    spawnSector: number,
    targetVillage: string,
    eventId: string,
    hopCount: number,
): number[] | null {
    const targetSector = VILLAGE_OUTSKIRTS[targetVillage];
    if (!eventId || !Number.isInteger(hopCount) || hopCount < 1
        || !Number.isInteger(spawnSector) || !Number.isInteger(targetSector)) return null;
    const cacheKey = `${eventId}:${spawnSector}:${targetVillage}:${hopCount}`;
    const cached = eventRouteCache.get(cacheKey);
    if (cached) {
        eventRouteCache.delete(cacheKey);
        eventRouteCache.set(cacheKey, cached);
        return [...cached];
    }
    const shortest = shortestRoadRoute(spawnSector, targetSector);
    if (!shortest) return null;

    const reachableIn = Array.from({ length: hopCount + 1 }, () => new Set<number>());
    reachableIn[0]!.add(targetSector);
    for (let remaining = 1; remaining <= hopCount; remaining += 1) {
        const nextReachable = reachableIn[remaining - 1]!;
        const currentReachable = reachableIn[remaining]!;
        for (const sector of ROAM_SECTORS) {
            if (sector === targetSector) continue;
            if ((ROAD_NEIGHBORS.get(sector) ?? []).some(neighbor => nextReachable.has(neighbor))) {
                currentReachable.add(sector);
            }
        }
    }

    const seed = hash32(`world-boss-event-route:${eventId}:${spawnSector}:${targetVillage}`);
    const distances = shortestDistancesTo(targetSector);
    const route = [spawnSector];
    let current = spawnSector;
    for (let step = 1; step <= hopCount; step += 1) {
        const remaining = hopCount - step;
        let candidates = (ROAD_NEIGHBORS.get(current) ?? [])
            .filter(next => reachableIn[remaining]!.has(next));
        if (!candidates.length) return null;

        // Avoid an immediate out-and-back when another exact-length route is
        // available. The reachability table still guarantees the final arrival.
        if (step < hopCount && candidates.length > 1) {
            const withoutBacktrack = candidates.filter(next => next !== route[route.length - 2]);
            if (withoutBacktrack.length) candidates = withoutBacktrack;
        }

        const progress = step / hopCount;
        if (progress >= 0.72 && candidates.length > 1) {
            const closest = Math.min(...candidates.map(next => distances.get(next) ?? Infinity));
            const closingChoices = candidates.filter(next => (distances.get(next) ?? Infinity) <= closest + 1);
            if (closingChoices.length) candidates = closingChoices;
        }
        candidates.sort((a, b) => a - b);
        const next = candidates[hopRandom(seed, step) % candidates.length]!;
        route.push(next);
        current = next;
    }
    if (current !== targetSector) return null;
    eventRouteCache.set(cacheKey, route);
    while (eventRouteCache.size > EVENT_ROUTE_CACHE_LIMIT) {
        const oldest = eventRouteCache.keys().next().value;
        if (oldest === undefined) break;
        eventRouteCache.delete(oldest);
    }
    return route;
}

const ROAM_SECTORS = SECTOR_POINTS.filter(point => isPlayableWildSector(point.id)).map(point => point.id);
const NEIGHBORS = (() => {
    const points = SECTOR_POINTS.filter(point => isPlayableWildSector(point.id));
    return new Map(points.map(point => [
        point.id,
        points
            .filter(other => other.id !== point.id)
            .map(other => ({ id: other.id, distance: (point.x - other.x) ** 2 + (point.y - other.y) ** 2 }))
            .sort((a, b) => a.distance - b.distance || a.id - b.id)
            .slice(0, 5)
            .map(other => other.id),
    ]));
})();

function pathFor(seed: number, hop: number): number[] {
    if (!ROAM_SECTORS.length) return [];
    const path = [ROAM_SECTORS[seed % ROAM_SECTORS.length]!];
    for (let index = 1; index <= hop; index += 1) {
        const previous = path[index - 1]!;
        const neighbors = NEIGHBORS.get(previous) ?? [previous];
        const cameFrom = index >= 2 ? path[index - 2] : -1;
        const forward = neighbors.filter(sector => sector !== cameFrom);
        const choices = forward.length ? forward : neighbors;
        path.push(choices[hopRandom(seed, index) % choices.length]!);
    }
    return path;
}

/** Deterministic map position, on the same 13-minute beat as the existing roaming boss. */
export function worldBossEventPosition(
    event: WorldBossRoamInput | null | undefined,
    now: number,
): WorldBossEventPosition | null {
    if (!event || !event.eventId || !Number.isFinite(event.startedAt) || !ROAM_SECTORS.length) return null;
    const completedPauseMs = Math.max(0, Math.floor(Number(event.movementPausedTotalMs) || 0));
    const activePauseMs = event.movementPausedAt != null
        ? Math.max(0, Math.min(now, event.roamEndsAt) - Math.max(event.startedAt, event.movementPausedAt))
        : 0;
    const elapsed = Math.max(0, now - event.startedAt - completedPauseMs - activePauseMs);
    const started = now >= event.startedAt;
    const maximumTimelineHop = Math.max(0, Math.floor((event.roamEndsAt - event.startedAt) / WORLD_BOSS_EVENT_HOP_MS));
    const movingHop = started ? Math.floor(elapsed / WORLD_BOSS_EVENT_HOP_MS) : 0;
    const hasSelectedRoute = event.spawnSector != null || event.targetVillage != null;
    const selectedRoute = hasSelectedRoute && event.spawnSector != null && event.targetVillage
        ? worldBossEventRoute(event.spawnSector, event.targetVillage, event.eventId, maximumTimelineHop)
        : null;
    if (hasSelectedRoute && !selectedRoute) return null;
    const seed = hash32(`world-boss-event:${event.eventId}`);
    const path = selectedRoute ?? pathFor(seed, maximumTimelineHop + 1);
    const maximumRouteHop = Math.max(0, path.length - 1);
    const maximumRoamHop = Math.min(maximumTimelineHop, maximumRouteHop);
    const selectedRouteAtFinalStand = !!selectedRoute && now >= event.roamEndsAt;
    const hopIndex = selectedRouteAtFinalStand ? maximumRoamHop : Math.min(movingHop, maximumRoamHop);
    const currentSector = path[hopIndex] ?? ROAM_SECTORS[0]!;
    const nextSector = hopIndex < maximumRoamHop ? path[hopIndex + 1] ?? currentSector : currentSector;
    const moving = started && now < event.roamEndsAt && hopIndex < maximumRouteHop;
    return {
        active: started && now < event.endsAt,
        currentSector,
        nextSector,
        hopIndex,
        nextHopInMs: moving ? WORLD_BOSS_EVENT_HOP_MS - (elapsed % WORLD_BOSS_EVENT_HOP_MS) : 0,
        hopIntervalMs: WORLD_BOSS_EVENT_HOP_MS,
        movementPaused: moving && event.movementPausedAt != null,
        targetSector: selectedRoute?.at(-1) ?? null,
        destinationReached: !!selectedRoute && currentSector === selectedRoute.at(-1),
    };
}

export function worldBossEventStatus(event: WorldBossRoamInput & { status: WorldBossEventStatus }, now: number): WorldBossEventStatus {
    if (event.status === 'victory' || event.status === 'retreated' || event.status === 'stopped') return event.status;
    if (now >= event.endsAt) return 'retreated';
    return now >= event.roamEndsAt ? 'final-stand' : 'roaming';
}
