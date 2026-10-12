type RoomTile = { kind: string; roomId?: number | null };
export type UndergroundRoom = { x: number; y: number; width: number; height: number };

export function undergroundRooms(tiles: readonly RoomTile[], width: number): Map<number, UndergroundRoom> {
    const rooms = new Map<number, UndergroundRoom>();
    tiles.forEach((tile, i) => {
        if (tile.roomId == null || tile.kind === 'wall') return;
        const x = i % width, y = Math.floor(i / width), previous = rooms.get(tile.roomId);
        if (!previous) rooms.set(tile.roomId, { x, y, width: 1, height: 1 });
        else {
            const left = Math.min(previous.x, x), top = Math.min(previous.y, y);
            rooms.set(tile.roomId, { x: left, y: top, width: Math.max(previous.x + previous.width, x + 1) - left,
                height: Math.max(previous.y + previous.height, y + 1) - top });
        }
    });
    return rooms;
}

/** Scale the world around its smaller chambers, rather than showing a miniature
 * floor plan. The scale stays stable while crossing a floor's rooms. */
export function undergroundTileSize(view: { width: number; height: number }, rooms: ReadonlyMap<number, UndergroundRoom>, frameArchitecture = false): number {
    const sorted = (axis: 'width' | 'height') => [...rooms.values()].map(r => r[axis]).sort((a, b) => a - b);
    const widths = sorted('width'), heights = sorted('height');
    const compact = (sizes: number[], fallback: number) => sizes[0] ?? fallback;
    const worldScale = Math.max(view.width / (compact(widths, 7) + .9), view.height / (compact(heights, 5) + .9));
    // Desktop strongholds need their north/south stations visible together.
    // Phones retain the established world scale and player-following camera.
    const desired = frameArchitecture && view.width > 620 && view.height > 420
        ? Math.min(worldScale, view.height / (compact(heights, 5) + .6)) : worldScale;
    return Math.round(Math.max(48, Math.min(view.width <= 480 ? 112 : 192, desired)));
}

/** First Pact-style framing: center an axis that fits and follow the player
 * through an axis that does not, clamped to the chamber's own perimeter. */
export function undergroundCamera(args: {
    view: { width: number; height: number }; width: number; height: number;
    tileSize: number; playerX: number; playerY: number; room?: UndergroundRoom;
}): { x: number; y: number } {
    const { view, width, height, tileSize, playerX, playerY, room } = args;
    const axis = (viewSize: number, mapTiles: number, player: number, start?: number, span?: number) => {
        const lo = start == null ? 0 : Math.max(0, start - 1) * tileSize;
        const hi = start == null || span == null ? mapTiles * tileSize : Math.min(mapTiles, start + span + 1) * tileSize;
        const extent = hi - lo;
        if (extent <= viewSize) return (viewSize - extent) / 2 - lo;
        return -Math.max(lo, Math.min(hi - viewSize, (player + .5) * tileSize - viewSize / 2));
    };
    return { x: axis(view.width, width, playerX, room?.x, room?.width), y: axis(view.height, height, playerY, room?.y, room?.height) };
}

/** Bound SVG raster work to the camera, retaining world coordinates and two
 * tiles of overscan for the existing one-step camera transition. */
export function undergroundRenderWindow(args: {
    view: { width: number; height: number }; width: number; height: number;
    tileSize: number; camera: { x: number; y: number };
}): { left: number; top: number; width: number; height: number } {
    const { view, width, height, tileSize, camera } = args;
    if (view.width <= 0 || view.height <= 0 || tileSize <= 0) return { left: 0, top: 0, width: 0, height: 0 };
    const left = Math.max(0, Math.floor(-camera.x / tileSize) - 2);
    const top = Math.max(0, Math.floor(-camera.y / tileSize) - 2);
    const right = Math.min(width, Math.ceil((-camera.x + view.width) / tileSize) + 2);
    const bottom = Math.min(height, Math.ceil((-camera.y + view.height) / tileSize) + 2);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
