/*
 * The shape of the Unmapped Coast's geography and the rules it must pass.
 *
 * Used twice: by scripts/admit-coast-world.mts before it writes
 * shared/coast-world.json, and by shared/coast-world.test.ts against the file
 * that is committed. Pure, with no data import, so both can load it.
 */
import { COAST_SECTOR_IDS, coastRegionOf, isCoastSector } from './world-maps.js';

export type CoastDirection = 'north' | 'south' | 'east' | 'west';

export interface CoastExit {
    /** `<sector>:<direction>:<destination>`, the same form home exits use. */
    id: string;
    sector: number;
    direction: CoastDirection;
    /** The boundary tile the trail leaves by. */
    tile: number;
    destinationSector: number;
    destinationExitId: string;
    /** Where the walker lands: one step inside the destination's matching edge. */
    destinationTile: number;
    lane: number;
}

export interface CoastStation { name: string; approach: number; target: number[]; detail: string; clue?: number; locked?: string }
export interface CoastStair { label: string; tile: number; to: number; arrival: number; target: number[] }
export interface CoastFloor {
    title: string;
    /** The room's painting, as a path under public/coast-map/. */
    art?: string;
    mask: string[]; spawn: number; doors: number[]; stations: CoastStation[]; stairs: CoastStair[];
}

/** An art path under public/coast-map/: `<region>/<kind>/<file>.webp`. */
const ART_REF = /^[a-z0-9-]+\/(interiors|landmarks|scenes)\/[a-z0-9-]+\.webp$/;

export interface CoastSite {
    id: string;
    name: string;
    role: string;
    verb: string;
    description: string;
    /** The outdoor tile the player stands on to use the site. */
    approach: number;
    /** Where leaving the site puts the player. */
    returnTile: number;
    /** [x, y, size] of the solid ground the landmark covers. */
    footprint: number[];
    left: number; top: number; width: number;
    /** The landmark standee and the entry painting, as paths under public/coast-map/. */
    sprite?: string;
    scene?: string;
    actions: string[];
    proposedQuest: string;
    /** Walkable interior floors, ground floor first. Empty for an open-air site. */
    floors: CoastFloor[];
}

export interface CoastLayout {
    /** Versioned painting for sectors whose original floor has since changed. */
    floor?: string;
    name: string;
    /** One of the game's five gameplay biomes. */
    biome: string;
    /** How the art pack describes the ground, for presentation only. */
    terrain: string;
    /** True where a clan may found a Landing. */
    contestable: boolean;
    /** 12 rows of 12 characters: . ground, = trail, # rock, T tree, ~ water, B building. */
    mask: string[];
    water: number[];
    sites: Record<string, CoastSite>;
}

export interface CoastWorldData {
    /** Graph version. Saved walk cursors name it, so it changes only with the geometry. */
    version: string;
    atlas: { width: number; height: number };
    /** Region names, region 1 first. */
    regions: string[];
    /** Atlas pin for every sector, in atlas pixels. */
    points: { sector: number; x: number; y: number; region: number }[];
    roads: [number, number][];
    exits: Record<string, CoastExit[]>;
    /** Present only for sectors whose floor has been painted and admitted. */
    layouts: Record<string, CoastLayout>;
    space: {
        chunks: { sector: number; x: number; y: number; size: number }[];
        roads: { a: string; b: string; points: { x: number; y: number }[]; length: number }[];
    };
}

export const COAST_GRID = 12;
export const COAST_TILE_COUNT = COAST_GRID * COAST_GRID;
const MASK_CHARS = /^[.=#T~B]{12}$/;
const BIOMES = new Set(['shadow', 'forest', 'volcano', 'snow', 'central']);
const OPPOSITE: Record<CoastDirection, CoastDirection> = { north: 'south', south: 'north', east: 'west', west: 'east' };

const isTile = (tile: unknown): tile is number => Number.isInteger(tile) && (tile as number) >= 0 && (tile as number) < COAST_TILE_COUNT;
const maskOk = (mask: unknown): mask is string[] => Array.isArray(mask) && mask.length === COAST_GRID && mask.every(row => typeof row === 'string' && MASK_CHARS.test(row));
/** Ground and trail can be walked. Rock, trees, water and buildings cannot. */
export const coastTileWalkable = (mask: readonly string[], tile: number) => {
    const cell = mask[Math.floor(tile / COAST_GRID)]?.[tile % COAST_GRID];
    return cell === '.' || cell === '=';
};

/** True when every walkable tile of a mask can be reached from `start`. */
function connected(mask: readonly string[], start: number): boolean {
    const walkable = new Set<number>();
    for (let tile = 0; tile < COAST_TILE_COUNT; tile++) if (coastTileWalkable(mask, tile)) walkable.add(tile);
    if (!walkable.has(start)) return false;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
        const tile = queue.pop()!;
        const x = tile % COAST_GRID;
        for (const next of [tile - COAST_GRID, tile + COAST_GRID, x > 0 ? tile - 1 : -1, x < COAST_GRID - 1 ? tile + 1 : -1]) {
            if (walkable.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
    }
    return seen.size === walkable.size;
}

function onEdge(tile: number, direction: CoastDirection): boolean {
    const x = tile % COAST_GRID, y = Math.floor(tile / COAST_GRID);
    return direction === 'north' ? y === 0 : direction === 'south' ? y === COAST_GRID - 1 : direction === 'west' ? x === 0 : x === COAST_GRID - 1;
}

/** Every problem in the data, as plain sentences. An empty list means it may be admitted. */
export function coastWorldProblems(data: CoastWorldData): string[] {
    const problems: string[] = [];
    if (!data.version) problems.push('no graph version');
    if (data.regions.length !== 5) problems.push(`expected 5 region names, found ${data.regions.length}`);

    // Pins: exactly the fifty coast sectors, each in the region its number implies.
    const pinned = data.points.map(point => point.sector).sort((a, b) => a - b);
    if (JSON.stringify(pinned) !== JSON.stringify(COAST_SECTOR_IDS)) problems.push('pins must cover sectors 101-150 exactly once each');
    for (const point of data.points) {
        if (point.region !== coastRegionOf(point.sector)) problems.push(`sector ${point.sector}: pinned in region ${point.region}, its number says ${coastRegionOf(point.sector)}`);
        if (point.x < 0 || point.x > data.atlas.width || point.y < 0 || point.y > data.atlas.height) problems.push(`sector ${point.sector}: pin is off the atlas`);
    }

    // Roads and exits: every road has one exit each way, and they agree.
    const exitById = new Map<string, CoastExit>();
    for (const [sector, exits] of Object.entries(data.exits)) {
        for (const exit of exits) {
            if (String(exit.sector) !== sector) problems.push(`exit ${exit.id}: filed under sector ${sector}`);
            if (exit.id !== `${exit.sector}:${exit.direction}:${exit.destinationSector}`) problems.push(`exit ${exit.id}: id does not match its sector, direction and destination`);
            if (exitById.has(exit.id)) problems.push(`exit ${exit.id}: listed twice`);
            exitById.set(exit.id, exit);
            if (!isCoastSector(exit.sector) || !isCoastSector(exit.destinationSector)) problems.push(`exit ${exit.id}: leaves the coast`);
            if (!isTile(exit.tile) || !onEdge(exit.tile, exit.direction)) problems.push(`exit ${exit.id}: tile ${exit.tile} is not on the ${exit.direction} edge`);
            if (!isTile(exit.destinationTile)) problems.push(`exit ${exit.id}: bad arrival tile`);
        }
    }
    for (const exit of exitById.values()) {
        const back = exitById.get(exit.destinationExitId);
        if (!back) { problems.push(`exit ${exit.id}: no return exit ${exit.destinationExitId}`); continue; }
        if (back.destinationExitId !== exit.id) problems.push(`exit ${exit.id}: its return exit points elsewhere`);
        if (back.direction !== OPPOSITE[exit.direction]) problems.push(`exit ${exit.id}: return exit is not on the opposite edge`);
        if (back.lane !== exit.lane) problems.push(`exit ${exit.id}: the two ends use different lanes`);
    }
    const roadKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
    const roadKeys = new Set<string>();
    for (const [a, b] of data.roads) {
        if (roadKeys.has(roadKey(a, b))) problems.push(`road ${a}-${b}: listed twice`);
        roadKeys.add(roadKey(a, b));
        const there = (data.exits[String(a)] ?? []).filter(exit => exit.destinationSector === b);
        const back = (data.exits[String(b)] ?? []).filter(exit => exit.destinationSector === a);
        if (there.length !== 1 || back.length !== 1) problems.push(`road ${a}-${b}: needs exactly one exit each way`);
    }
    for (const exit of exitById.values()) {
        if (!roadKeys.has(roadKey(exit.sector, exit.destinationSector))) problems.push(`exit ${exit.id}: no road joins those sectors`);
    }
    // One connected coast: every sector can be reached from the landing.
    const reached = new Set([COAST_SECTOR_IDS[0]]);
    for (let grew = true; grew;) {
        grew = false;
        for (const [a, b] of data.roads) {
            if (reached.has(a) !== reached.has(b)) { reached.add(a); reached.add(b); grew = true; }
        }
    }
    if (reached.size !== COAST_SECTOR_IDS.length) problems.push(`only ${reached.size} of 50 sectors can be reached from the landing`);

    // Layouts: painted sectors only.
    const siteIds = new Set<string>();
    for (const [key, layout] of Object.entries(data.layouts)) {
        const sector = Number(key);
        const at = `sector ${key}`;
        if (!isCoastSector(sector)) { problems.push(`${at}: layout for a sector off the coast`); continue; }
        if (!layout.name.trim()) problems.push(`${at}: no name`);
        if (!BIOMES.has(layout.biome)) problems.push(`${at}: unknown biome ${layout.biome}`);
        if (!maskOk(layout.mask)) { problems.push(`${at}: mask must be 12 rows of 12 of . = # T ~ B`); continue; }
        const exits = data.exits[key] ?? [];
        for (const exit of exits) {
            if (!coastTileWalkable(layout.mask, exit.tile)) problems.push(`${at}: exit ${exit.id} leaves from a blocked tile`);
        }
        for (const other of Object.values(data.exits).flat()) {
            if (other.destinationSector === sector && !coastTileWalkable(layout.mask, other.destinationTile)) problems.push(`${at}: arriving by ${other.id} lands on a blocked tile`);
        }
        const start = exits[0]?.tile;
        if (start === undefined) problems.push(`${at}: no way in or out`);
        else if (!connected(layout.mask, start)) problems.push(`${at}: some walkable ground cannot be reached`);
        for (const [siteKey, site] of Object.entries(layout.sites)) {
            const where = `${at} site ${site.id}`;
            if (site.id !== siteKey) problems.push(`${where}: filed under ${siteKey}`);
            if (siteIds.has(site.id)) problems.push(`${where}: id used twice on the coast`);
            siteIds.add(site.id);
            if (!site.name.trim()) problems.push(`${where}: no name`);
            for (const [label, tile] of [['approach', site.approach], ['return', site.returnTile]] as const) {
                if (!isTile(tile) || !coastTileWalkable(layout.mask, tile)) problems.push(`${where}: ${label} tile ${tile} cannot be stood on`);
            }
            for (const [label, ref] of [['landmark', site.sprite], ['entry scene', site.scene]] as const) {
                if (ref !== undefined && !ART_REF.test(ref)) problems.push(`${where}: ${label} path "${ref}" is not a coast art path`);
            }
            site.floors.forEach((floor, index) => {
                const room = `${where} floor ${index}`;
                if (floor.art !== undefined && !ART_REF.test(floor.art)) problems.push(`${room}: painting path "${floor.art}" is not a coast art path`);
                if (!maskOk(floor.mask)) { problems.push(`${room}: mask must be 12 rows of 12`); return; }
                if (!isTile(floor.spawn) || !coastTileWalkable(floor.mask, floor.spawn)) problems.push(`${room}: spawn tile cannot be stood on`);
                else if (!connected(floor.mask, floor.spawn)) problems.push(`${room}: some of the room cannot be reached`);
                if (index === 0 && !floor.doors.length) problems.push(`${room}: the ground floor has no door`);
                for (const door of floor.doors) if (!isTile(door) || !coastTileWalkable(floor.mask, door)) problems.push(`${room}: door tile ${door} cannot be stood on`);
                for (const station of floor.stations) if (!isTile(station.approach) || !coastTileWalkable(floor.mask, station.approach)) problems.push(`${room}: cannot stand at "${station.name}"`);
                for (const stair of floor.stairs) {
                    if (!isTile(stair.tile) || !coastTileWalkable(floor.mask, stair.tile)) problems.push(`${room}: stair "${stair.label}" cannot be stood on`);
                    const target = site.floors[stair.to];
                    if (!target || stair.to === index) problems.push(`${room}: stair "${stair.label}" leads nowhere`);
                    else if (maskOk(target.mask) && (!isTile(stair.arrival) || !coastTileWalkable(target.mask, stair.arrival))) problems.push(`${room}: stair "${stair.label}" arrives on a blocked tile`);
                }
            });
        }
    }

    // Walk space: one chunk per sector, one corridor per road.
    if (data.space.chunks.length !== COAST_SECTOR_IDS.length) problems.push(`walk space has ${data.space.chunks.length} chunks, expected 50`);
    if (data.space.roads.length !== data.roads.length) problems.push(`walk space has ${data.space.roads.length} corridors for ${data.roads.length} roads`);
    for (const corridor of data.space.roads) {
        if (!exitById.has(corridor.a) || !exitById.has(corridor.b)) problems.push(`corridor ${corridor.a} to ${corridor.b}: unknown exit`);
    }
    return problems;
}
