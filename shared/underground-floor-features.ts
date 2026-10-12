export type FurnishingTile = { kind: string; terrain?: string; roomId?: number | null };
export type FurnishingRoom = { roomId: number; x: number; y: number; right: number; bottom: number; cx: number; cy: number };
export type RoomFurnishing = { roomId: number; x: number; y: number; role: string; width: number; height: number; purpose: string };
export type UndergroundFloorFeature = { roomId: number; role: string; purpose: string; left: number; top: number; span: number; cells: number[] };
type Placement = [role: string, x: number, y: number, width: number, height: number, purpose: string];

/** Explicit room plans, with a clear cross of travel lanes through the center.
 * Coordinates are fractions of each room, measured at the prop's ground anchor.
 * Doorways and gameplay nodes always win over decorative furniture. */
const BASE_PLANS: Record<number, Placement[]> = {
    0: [['banner-pillar', .22, .16, .45, 1.05, 'entry insignia'], ['banner-pillar', .78, .16, .45, 1.05, 'entry insignia']],
    1: [['bunk', .23, .18, 1.15, .9, 'barracks sleeping row'], ['bunk', .77, .18, 1.15, .9, 'barracks sleeping row']],
    2: [['weapon-rack', .23, .18, 1.05, 1, 'armory storage wall'], ['weapon-rack', .77, .18, 1.05, 1, 'armory storage wall']],
    3: [['war-table', .25, .82, 1.3, .85, 'signal operations desk'], ['banner-pillar', .8, .18, .45, 1.05, 'signal insignia']],
    4: [['supplies', .2, .18, 1.15, .9, 'supply storage row'], ['supplies', .8, .18, 1.15, .9, 'supply storage row']],
    5: [['training-dummy', .22, .8, .85, 1.1, 'practice station'], ['weapon-rack', .78, .8, .95, 1, 'practice weapons']],
    6: [['archives', .23, .18, 1.1, 1.15, 'archive shelves'], ['archives', .77, .18, 1.1, 1.15, 'archive shelves']],
    7: [['war-table', .23, .82, 1.2, .8, 'officer planning desk'], ['bunk', .78, .82, 1.1, .85, 'officer sleeping alcove']],
    8: [['cistern', .22, .8, 1.1, .95, 'fortress water reserve']],
    9: [['war-table', .23, .82, 1.2, .8, 'seal workbench'], ['archives', .78, .82, .9, 1, 'seal records']],
    10: [['guardian', .85, .18, .65, 1, 'vault approach sentry'], ['guardian', .85, .82, .65, 1, 'vault approach sentry']],
    11: [['banner-pillar', .22, .18, .45, 1, 'altar insignia'], ['banner-pillar', .78, .18, .45, 1, 'altar insignia']],
};
const TREASURY_PLAN: Placement[] = [
    ['guardian', .26, .16, .6, .95, 'entrance sentry'], ['guardian', .74, .16, .6, .95, 'entrance sentry'],
    ['reserve-chest', .24, .87, 1.1, .78, 'sealed war reserve row'], ['reserve-chest', .76, .87, 1.1, .78, 'sealed war reserve row'],
];

/** Architectural bays in the painted 7×5 room maps. North/south bays occupy
 * exactly three edge cells, leaving every midpoint entrance and central lane
 * open. These coordinates are also the artwork production specification. */
const STRONGHOLD_BAYS: Record<number, [string, number, boolean, string][]> = {
    0: [['banner-pillar', 1, false, 'gatehouse guard station'], ['banner-pillar', 4, false, 'gatehouse guard station']],
    1: [['bunk', 1, false, 'recessed barracks sleeping bay'], ['bunk', 4, false, 'recessed barracks sleeping bay']],
    2: [['weapon-rack', 1, false, 'built-in armory rack'], ['weapon-rack', 4, false, 'built-in armory rack']],
    3: [['war-table', 1, true, 'signal operations bench'], ['banner-pillar', 4, false, 'signal relay station']],
    4: [['supplies', 1, false, 'recessed quartermaster stores'], ['supplies', 4, false, 'recessed quartermaster stores']],
    5: [['training-dummy', 1, true, 'perimeter practice station'], ['weapon-rack', 4, true, 'built-in practice rack']],
    6: [['archives', 1, false, 'wall-integrated war records'], ['archives', 4, false, 'wall-integrated war records']],
    7: [['war-table', 1, true, 'officer planning alcove'], ['bunk', 4, true, 'officer resting alcove']],
    8: [['cistern', 1, true, 'recessed fortress water reserve']],
    9: [['war-table', 1, true, 'inscription workbench'], ['archives', 4, true, 'sealed scroll archive']],
    10: [['guardian', 4, false, 'north vault guard post'], ['guardian', 4, true, 'south vault guard post']],
    11: [['banner-pillar', 1, false, 'altar wall shrine'], ['banner-pillar', 4, false, 'altar wall shrine']],
};
const TREASURY_BAYS: [string, number, boolean, string][] = [
    ['guardian', 1, false, 'vault security alcove'], ['guardian', 4, false, 'vault security alcove'],
    ['reserve-chest', 1, true, 'built-in sealed war reserve'], ['reserve-chest', 4, true, 'built-in sealed war reserve'],
];

export function planUndergroundFurnishings(rooms: readonly FurnishingRoom[], tiles: readonly FurnishingTile[], width: number, cave: boolean, vault: boolean): RoomFurnishing[] {
    const result: RoomFurnishing[] = [];
    for (const room of rooms) {
        const content = tiles.filter(t => t.roomId === room.roomId).map(t => t.kind);
        const cavePlan: Placement[] = content.includes('boss')
            ? [['broken-pillar', .22, .18, .6, .95, 'sanctum colonnade'], ['broken-pillar', .78, .18, .6, .95, 'sanctum colonnade']]
            : [[content.includes('npc') ? 'lantern' : content.includes('story') ? 'broken-pillar' : 'stalagmites', .2, .83, .7, .85,
                content.includes('npc') ? 'keeper alcove light' : content.includes('story') ? 'ancient inscription alcove' : 'cavern perimeter rock']];
        const plan = cave ? cavePlan : vault && room.roomId === 11 ? TREASURY_PLAN : BASE_PLANS[room.roomId] ?? [];
        for (const [role, rx, ry, w, h, purpose] of plan) {
            const x = room.x + (room.right - room.x) * rx, y = room.y + (room.bottom - room.y) * ry;
            const tile = tiles[Math.floor(y) * width + Math.floor(x)];
            if (!tile || tile.kind !== 'empty' || tile.terrain === 'door') continue;
            // Furniture stays outside both center lanes, and no ground footprint
            // overlaps a door or content tile in the row it occupies.
            if (Math.abs(x - room.cx) < w / 2 + .55 || Math.abs(y - room.cy) < .8) continue;
            const footprint = [Math.floor(x - w / 2), Math.floor(x), Math.floor(x + w / 2)];
            if (footprint.some(cx => { const t = tiles[Math.floor(y) * width + cx]; return !t || t.kind !== 'empty' || t.terrain === 'door'; })) continue;
            result.push({ roomId: room.roomId, x, y, role, width: w, height: h, purpose });
        }
    }
    return result;
}

export function undergroundFeatureRooms(tiles: readonly FurnishingTile[], width: number): FurnishingRoom[] {
    const bounds = new Map<number, { x: number; y: number; right: number; bottom: number }>();
    tiles.forEach((tile, index) => {
        if (tile.roomId == null || tile.kind === 'wall' || tile.terrain === 'wall') return;
        const x = index % width, y = Math.floor(index / width), previous = bounds.get(tile.roomId);
        bounds.set(tile.roomId, previous ? { x: Math.min(previous.x, x), y: Math.min(previous.y, y), right: Math.max(previous.right, x + 1), bottom: Math.max(previous.bottom, y + 1) }
            : { x, y, right: x + 1, bottom: y + 1 });
    });
    return [...bounds].map(([roomId, b]) => ({ ...b, roomId, cx: (b.x + b.right) / 2, cy: (b.y + b.bottom) / 2 }));
}

const openTile = (tile: FurnishingTile | undefined) => !!tile && tile.kind !== 'wall' && tile.terrain !== 'wall';
export const undergroundFeatureBlocks = (features: readonly UndergroundFloorFeature[] | undefined, index: number) => features?.some(f => f.cells.includes(index)) === true;
export function undergroundFeatureWalkable(walkable: string, features: readonly UndergroundFloorFeature[] | undefined): string {
    if (!features?.length) return walkable;
    const cells = [...walkable];
    for (const feature of features) for (const index of feature.cells) cells[index] = '0';
    return cells.join('');
}

/** Physical ground footprints are grid-aligned. Do not seal a feature that
 * covers a node/door or disconnects any remaining floor from the spawn. */
export function planUndergroundFloorFeatures(tiles: readonly FurnishingTile[], width: number, cave: boolean, vault: boolean, spawn: number, protectedTiles: readonly number[] = []): UndergroundFloorFeature[] {
    const rooms = undergroundFeatureRooms(tiles, width);
    const plans = cave ? planUndergroundFurnishings(rooms, tiles, width, true, vault).map(prop => ({
        ...prop, span: prop.width > 1 ? 2 : 1, left: Math.floor(prop.x - (prop.width > 1 ? 2 : 1) / 2), top: Math.floor(prop.y),
    })) : rooms.flatMap(room => (vault && room.roomId === 11 ? TREASURY_BAYS : STRONGHOLD_BAYS[room.roomId] ?? []).map(([role, x, south, purpose]) => ({
        roomId: room.roomId, role, purpose, span: 3, left: room.x + (x === 1 ? 0 : 4), top: south ? room.bottom - 1 : room.y,
    })));
    const blocked = new Set<number>(), result: UndergroundFloorFeature[] = [];
    const neighbors = (index: number) => [index - width, index + 1, index + width, index - 1].filter(n => n >= 0 && n < tiles.length && Math.abs(n % width - index % width) + Math.abs(Math.floor(n / width) - Math.floor(index / width)) === 1);
    for (const prop of plans) {
        const { span, left, top } = prop;
        const cells = Array.from({ length: span }, (_, x) => top * width + left + x);
        if (left < 0 || left + span > width || cells.some(index => index === spawn || protectedTiles.includes(index) || blocked.has(index) || tiles[index]?.kind !== 'empty' || tiles[index]?.terrain === 'door' || tiles[index]?.roomId !== prop.roomId)) continue;
        for (const index of cells) blocked.add(index);
        const queue = [spawn], seen = new Set(queue);
        for (let i = 0; i < queue.length; i++) for (const next of neighbors(queue[i])) if (openTile(tiles[next]) && !blocked.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
        if (tiles.some((tile, index) => openTile(tile) && !blocked.has(index) && !seen.has(index))) { for (const index of cells) blocked.delete(index); continue; }
        result.push({ roomId: prop.roomId, role: prop.role, purpose: prop.purpose, left, top, span, cells });
    }
    return result;
}
