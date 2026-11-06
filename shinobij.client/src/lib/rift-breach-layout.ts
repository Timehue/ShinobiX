import { undergroundRooms, type UndergroundRoom } from './underground-sector-camera';

type Tile = { kind: string; terrain?: string; roomId?: number | null; secret?: boolean };
export type RiftBreachSite = { roomId: number; x: number; y: number; width: number; height: number; angle: number; cells: number[] };

/**
 * A rift's breaches are signposts, not wallpaper. At most two rooms get one
 * (one when the arrival room also holds the stairs; none for a room with no
 * usable stone, which no generated rift floor has):
 *   arrival   the room the rift tore you into (the floor's spawn room),
 *             on its first usable side in north, south, west, east order;
 *   way down  the room holding the descent, or the guardian on the last
 *             depth. Its breach goes on the wall nearest the stairs, so the
 *             glow reads as "deeper this way".
 * Every other room is plain, so a glowing hole never reads as a random exit.
 *
 * Breaches belong to existing solid boundary stone. A decorative abyss must
 * never turn an open route, doorway or gameplay node into an apparent hole.
 * That includes a walled-up doorway: a crypt room paints a doorway at the
 * middle of each side and closes an unused one with wall cells on its own
 * edge, so stone in front of a wall cell of the room's edge is never used.
 * Otherwise the glowing breach sits exactly where the doorway was painted and
 * reads as an exit nobody can walk through. A one-cell seam of rock between
 * two rooms is skipped for the same reason, and so is stone touching a secret
 * passage, so the glow never crowds the cracked wall that hints at it.
 *
 * Pass the run's own tiles: there a sealed secret passage is still open floor
 * (the painter redraws it as rock), so it can never be read as boundary stone.
 */
export function riftBreachSites(tiles: readonly Tile[], width: number, arrivalRoom: number | null | undefined): RiftBreachSite[] {
    const rooms = undergroundRooms(tiles, width);
    const height = Math.ceil(tiles.length / width);
    const wall = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
        && (tiles[y * width + x]?.kind === 'wall' || tiles[y * width + x]?.terrain === 'wall');
    const secret = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && tiles[y * width + x]?.secret === true;
    const wayDown = tiles.findIndex(tile => tile.kind === 'descend' || tile.kind === 'boss');
    const wayDownRoom = wayDown >= 0 ? tiles[wayDown].roomId ?? null : null;
    const sites: RiftBreachSite[] = [];
    // The way down first: when the arrival room also holds the stairs, its one
    // breach points at them.
    for (const roomId of [wayDownRoom, arrivalRoom]) {
        if (roomId == null || sites.some(site => site.roomId === roomId)) continue;
        const room = rooms.get(roomId);
        if (!room) continue;
        const candidates = roomBreachCandidates(roomId, room, width, height, wall, secret, roomId === wayDownRoom);
        const site = roomId === wayDownRoom
            ? nearest(candidates, (wayDown % width) + .5, Math.floor(wayDown / width) + .5)
            : candidates[0];
        if (site) sites.push(site);
    }
    return sites;
}

/** The arrival room of a floor, matching the generator's spawn rule: a crypt
 *  floor (it has a prefab record) always spawns in its entrance, room 0; an
 *  older BSP floor spawns in the room whose centre is furthest west. */
export function riftArrivalRoom(tiles: readonly Tile[], width: number, cryptFloor: boolean): number | null {
    const rooms = undergroundRooms(tiles, width);
    if (cryptFloor) return rooms.has(0) ? 0 : null;
    let best: number | null = null, bestX = Infinity;
    for (const id of [...rooms.keys()].sort((a, b) => a - b)) {
        const room = rooms.get(id)!, x = room.x + Math.floor(room.width / 2);
        if (x < bestX) { best = id; bestX = x; }
    }
    return best;
}

/** Candidate breaches around a room, side by side (north, south, west, east).
 *  The arrival room takes the middle of each side's longest run of usable
 *  stone; the way-down room (`slide`) may take any window of a run, so its
 *  breach can sit right beside the stairs. */
function roomBreachCandidates(roomId: number, room: UndergroundRoom, width: number, height: number,
    wall: (x: number, y: number) => boolean, secret: (x: number, y: number) => boolean, slide: boolean): RiftBreachSite[] {
    const outside = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height;
    // (ix, iy) steps from the boundary stone into the room's edge cell.
    const edges = [
        { x: room.x, y: room.y - 1, dx: 1, dy: 0, ix: 0, iy: 1, span: room.width, angle: 0 },
        { x: room.x, y: room.y + room.height, dx: 1, dy: 0, ix: 0, iy: -1, span: room.width, angle: 180 },
        { x: room.x - 1, y: room.y, dx: 0, dy: 1, ix: 1, iy: 0, span: room.height, angle: -90 },
        { x: room.x + room.width, y: room.y, dx: 0, dy: 1, ix: -1, iy: 0, span: room.height, angle: 90 },
    ];
    const out: RiftBreachSite[] = [];
    const site = (cells: number[], angle: number): RiftBreachSite => ({ roomId,
        x: cells.reduce((sum, i) => sum + i % width + .5, 0) / cells.length,
        y: cells.reduce((sum, i) => sum + Math.floor(i / width) + .5, 0) / cells.length,
        width: cells.length + .15, height: 1.4, angle, cells });
    for (const edge of edges) {
        const runs: number[][] = [];
        let segment: number[] = [];
        for (let i = 0; i <= edge.span; i++) {
            const x = edge.x + i * edge.dx, y = edge.y + i * edge.dy;
            // Usable stone: not in front of a walled-up doorway, and backed by
            // more rock (or the board's edge), never a one-cell seam between
            // two rooms, where the glow would read as a passage between them,
            // and not touching a secret passage's cracked wall.
            const usable = i < edge.span && wall(x, y) && !wall(x + edge.ix, y + edge.iy)
                && (outside(x - edge.ix, y - edge.iy) || wall(x - edge.ix, y - edge.iy))
                && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([sx, sy]) => secret(x + sx, y + sy));
            if (usable) segment.push(y * width + x);
            else { if (segment.length >= 2) runs.push(segment); segment = []; }
        }
        if (!runs.length) continue;
        if (slide) {
            for (const run of runs) {
                const count = Math.min(3, run.length);
                for (let start = 0; start + count <= run.length; start++) out.push(site(run.slice(start, start + count), edge.angle));
            }
            continue;
        }
        const longest = runs.reduce((best, run) => (run.length > best.length ? run : best));
        const count = Math.min(3, longest.length), start = Math.floor((longest.length - count) / 2);
        out.push(site(longest.slice(start, start + count), edge.angle));
    }
    return out;
}

function nearest(sites: RiftBreachSite[], x: number, y: number): RiftBreachSite | undefined {
    let best: RiftBreachSite | undefined, bestD = Infinity;
    for (const site of sites) {
        const d = Math.hypot(site.x - x, site.y - y);
        if (d < bestD) { best = site; bestD = d; }
    }
    return best;
}
