/** One shared floor per sector: clients and server must agree on every doorway. */
export const STRONGHOLD_DIMS = { width: 37, height: 23 } as const;
export const STRONGHOLD_LAYOUT_VERSION = 1;
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
};

export const strongholdIndex = (x: number, y: number) => y * STRONGHOLD_DIMS.width + x;
export const STRONGHOLD_SPAWN = strongholdIndex(5, 4);
export const STRONGHOLD_VAULT = strongholdIndex(32, 18);

export function buildStrongholdTiles(sector = 0): StrongholdTile[] {
    const { width, height } = STRONGHOLD_DIMS;
    const tiles: StrongholdTile[] = Array.from({ length: width * height }, () => ({
        kind: 'wall', terrain: 'wall', roomId: null, revealed: false, resolved: false,
    }));
    for (const room of STRONGHOLD_ROOMS) {
        for (let y = room.y; y < room.y + room.height; y++) {
            for (let x = room.x; x < room.x + room.width; x++) {
                tiles[strongholdIndex(x, y)] = {
                    kind: 'empty', terrain: 'room_floor', roomId: room.id, revealed: false, resolved: false,
                    ...((x === room.x || x === room.x + room.width - 1) && y === room.y ? { decoration: room.id % 2 } : {}),
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
    return tiles;
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
};

/** Reject repeats, row wrapping, teleporting, walls and the occupied boss tile. */
export function canStepStronghold(from: number, to: number, sector = 0): boolean {
    if (!Number.isInteger(to) || to < 0 || to >= STRONGHOLD_DIMS.width * STRONGHOLD_DIMS.height) return false;
    const width = STRONGHOLD_DIMS.width;
    const adjacent = Math.abs(from % width - to % width) + Math.abs(Math.floor(from / width) - Math.floor(to / width)) === 1;
    return adjacent && buildStrongholdTiles(sector)[to].kind === 'empty';
}

export function advanceStronghold(visit: StrongholdVisit, to: number): StrongholdVisit | null {
    if (visit.patrolId || visit.threat >= 100 || !canStepStronghold(visit.tile, to, visit.sector)) return null;
    return { ...visit, tile: to, steps: visit.steps + 1, version: visit.version + 1,
        threat: Math.min(100, visit.threat + STRONGHOLD_THREAT_PER_STEP),
        visited: visit.visited.includes(to) ? visit.visited : [...visit.visited, to] };
}
