/** One shared floor per sector: clients and server must agree on every doorway. */
import { planUndergroundFloorFeatures, type UndergroundFloorFeature } from './underground-floor-features.js';
export const STRONGHOLD_DIMS = { width: 37, height: 23 } as const;
export const STRONGHOLD_LAYOUT_VERSION = 1;
export const STRONGHOLD_MIN_LEVEL = 50;
/** Treasury raids remain endgame activities even when exploration unlocks earlier. */
export const ANBU_RAID_MIN_LEVEL = 100;
export function strongholdLevelEligible(level: unknown): boolean {
    const value = Number(level);
    return Number.isFinite(value) && value >= STRONGHOLD_MIN_LEVEL;
}
export const STRONGHOLD_THREAT_PER_STEP = 4;
export const DEATHS_GATE_STRONGHOLD_SECTOR = 99;
export const isDeathsGateStronghold = (sector: number) => sector === DEATHS_GATE_STRONGHOLD_SECTOR;
export const strongholdTitle = (sector: number) => isDeathsGateStronghold(sector) ? 'Obsidian Stronghold' : `Sector ${sector} Stronghold`;
/** Only the server may stamp the additional interior bonus onto a PvP session. */
export function strongholdPvpRewardMultiplier(sector: unknown, rewardStronghold?: unknown): number {
    return Number(sector) === DEATHS_GATE_STRONGHOLD_SECTOR ? (rewardStronghold === 'deathsgate' ? 4 : 2) : 1;
}
export const STRONGHOLD_ROOMS = [
    'Entry Hall', 'Watch Barracks', 'Armory', 'Signal Chamber',
    'Supply Depot', 'Training Hall', 'War Archives', 'Officer Quarters',
    'Cistern', 'Seal Workshop', 'Inner Guard', 'Anbu Vault',
].map((name, id) => ({ id, name, x: 2 + (id % 4) * 9, y: 2 + Math.floor(id / 4) * 7, width: 7, height: 5 }));
const OBSIDIAN_ROOM_NAMES = ['Ashen Threshold', 'Cinder Barracks', 'Obsidian Armory', 'Ember Watch',
    'Charred Stores', 'Crucible', 'Hall of Echoes', 'Warden Quarters',
    'Blackwater Cistern', 'Soul Forge', 'Mourning Hall', 'Blood Altar'];
export const OBSIDIAN_STRONGHOLD_ROOMS = STRONGHOLD_ROOMS.map((room, id) => ({ ...room, name: OBSIDIAN_ROOM_NAMES[id] }));
export const strongholdRooms = (sector: number) => isDeathsGateStronghold(sector) ? OBSIDIAN_STRONGHOLD_ROOMS : STRONGHOLD_ROOMS;

export type StrongholdTile = {
    kind: 'wall' | 'empty' | 'boss';
    terrain: 'wall' | 'room_floor' | 'corridor_floor' | 'door';
    roomId: number | null;
    decoration?: number;
    revealed: boolean;
    resolved: boolean;
    solid?: boolean;
};

export const strongholdIndex = (x: number, y: number) => y * STRONGHOLD_DIMS.width + x;
export const STRONGHOLD_SPAWN = strongholdIndex(5, 4);
export const STRONGHOLD_VAULT = strongholdIndex(32, 18);
/** Optional, non-economic field-intel objective in the War Archives. */
export const STRONGHOLD_INTEL_ROOM_ID = 6;
export const STRONGHOLD_INTEL_TILE = strongholdIndex(23, 11);

const floorTemplates = new Map<boolean, StrongholdTile[]>();
export function buildStrongholdTiles(sector = 0): StrongholdTile[] {
    const key = isDeathsGateStronghold(sector), template = floorTemplates.get(key);
    if (template) return template.map(tile => ({ ...tile }));
    const { width, height } = STRONGHOLD_DIMS;
    const tiles: StrongholdTile[] = Array.from({ length: width * height }, () => ({
        kind: 'wall', terrain: 'wall', roomId: null, revealed: false, resolved: false,
    }));
    for (const room of STRONGHOLD_ROOMS) {
        for (let y = room.y; y < room.y + room.height; y++) {
            for (let x = room.x; x < room.x + room.width; x++) {
                tiles[strongholdIndex(x, y)] = {
                    kind: 'empty', terrain: 'room_floor', roomId: room.id, revealed: false, resolved: false,
                };
            }
        }
    }
    // Three wings with cross passages and alternate routes.
    const links = [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [8, 9], [9, 10], [10, 11],
        [0, 4], [2, 6], [3, 7], [4, 8], [5, 9], [7, 11]];
    for (const [a, b] of links) {
        const from = STRONGHOLD_ROOMS[a], to = STRONGHOLD_ROOMS[b];
        const x1 = from.x + 3, y1 = from.y + 2, x2 = to.x + 3, y2 = to.y + 2;
        const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
        for (let x = x1, y = y1; x !== x2 || y !== y2; x += dx, y += dy) {
            const tile = tiles[strongholdIndex(x, y)];
            if (tile.kind === 'wall') { tile.kind = 'empty'; tile.terrain = 'corridor_floor'; }
        }
    }
    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (tile.terrain !== 'room_floor') continue;
        if ([i - 1, i + 1, i - width, i + width].some(j => tiles[j]?.terrain === 'corridor_floor')) tile.terrain = 'door';
    }
    // The Blood Altar is an open dueling chamber, with no village treasury boss.
    if (!isDeathsGateStronghold(sector)) tiles[STRONGHOLD_VAULT].kind = 'boss';
    for (const feature of strongholdFloorFeatures(sector, tiles)) for (const index of feature.cells) tiles[index].solid = true;
    floorTemplates.set(key, tiles.map(tile => ({ ...tile })));
    return tiles;
}

export function strongholdFloorFeatures(sector: number, tiles: StrongholdTile[]): UndergroundFloorFeature[] {
    return planUndergroundFloorFeatures(tiles, STRONGHOLD_DIMS.width, false, !isDeathsGateStronghold(sector), STRONGHOLD_SPAWN);
}

/** Move an old visit out of a newly solid footprint without erasing threat. */
export function strongholdSafeTile(tile: number, sector: number): number {
    const tiles = buildStrongholdTiles(sector), queue = [tile], seen = new Set(queue), width = STRONGHOLD_DIMS.width;
    for (let i = 0; i < queue.length; i++) {
        const index = queue[i];
        if (tiles[index]?.kind === 'empty' && !tiles[index].solid) return index;
        for (const next of [index - width, index + 1, index + width, index - 1]) if (tiles[next] && tiles[next].kind !== 'wall' && !seen.has(next) && Math.abs(next % width - index % width) + Math.abs(Math.floor(next / width) - Math.floor(index / width)) === 1) { seen.add(next); queue.push(next); }
    }
    return STRONGHOLD_SPAWN;
}

export type StrongholdVisit = {
    /** The currently admitted exploration tab; cleared on an explicit exit. */
    presenceId?: string;
    id: string;
    layoutVersion: number;
    sector: number;
    tile: number;
    steps: number;
    threat: number;
    version: number;
    visited: number[];
    patrolId?: string;
    /** One-time, visit-bound intel interaction. It awards no currency or items. */
    intelClaimed?: boolean;
};

/** Reject repeats, row wrapping, teleporting, walls and the occupied boss tile. */
export function canStepStronghold(from: number, to: number, sector = 0): boolean {
    if (!Number.isInteger(from) || from < 0 || from >= STRONGHOLD_DIMS.width * STRONGHOLD_DIMS.height) return false;
    if (!Number.isInteger(to) || to < 0 || to >= STRONGHOLD_DIMS.width * STRONGHOLD_DIMS.height) return false;
    const width = STRONGHOLD_DIMS.width;
    const adjacent = Math.abs(from % width - to % width) + Math.abs(Math.floor(from / width) - Math.floor(to / width)) === 1;
    const tile = buildStrongholdTiles(sector)[to];
    return adjacent && tile.kind === 'empty' && !tile.solid;
}

export function advanceStronghold(visit: StrongholdVisit, to: number): StrongholdVisit | null {
    if (visit.patrolId || visit.threat >= 100 || !canStepStronghold(visit.tile, to, visit.sector)) return null;
    return { ...visit, tile: to, steps: visit.steps + 1, version: visit.version + 1,
        threat: Math.min(100, visit.threat + STRONGHOLD_THREAT_PER_STEP),
        visited: visit.visited.includes(to) ? visit.visited : [...visit.visited, to] };
}
