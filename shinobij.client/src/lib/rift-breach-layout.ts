import { undergroundRooms } from './underground-sector-camera';

type Tile = { kind: string; terrain?: string; roomId?: number | null };
export type RiftBreachSite = { roomId: number; x: number; y: number; width: number; height: number; angle: number; cells: number[] };

/** Breaches belong to existing solid boundary stone. A decorative abyss must
 * never turn an open route, doorway or gameplay node into an apparent hole. */
export function riftBreachSites(tiles: readonly Tile[], width: number): RiftBreachSite[] {
    const sites: RiftBreachSite[] = [];
    const height = Math.ceil(tiles.length / width);
    const wall = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height
        && (tiles[y * width + x]?.kind === 'wall' || tiles[y * width + x]?.terrain === 'wall');
    for (const [roomId, room] of undergroundRooms(tiles, width)) {
        const edges = [
            { x: room.x, y: room.y - 1, dx: 1, dy: 0, span: room.width, angle: 0 },
            { x: room.x, y: room.y + room.height, dx: 1, dy: 0, span: room.width, angle: 180 },
            { x: room.x - 1, y: room.y, dx: 0, dy: 1, span: room.height, angle: -90 },
            { x: room.x + room.width, y: room.y, dx: 0, dy: 1, span: room.height, angle: 90 },
        ];
        let site: RiftBreachSite | undefined;
        for (const edge of edges) {
            let segment: number[] = [], longest: number[] = [];
            for (let i = 0; i <= edge.span; i++) {
                const x = edge.x + i * edge.dx, y = edge.y + i * edge.dy;
                if (i < edge.span && wall(x, y)) segment.push(y * width + x);
                else { if (segment.length > longest.length) longest = segment; segment = []; }
            }
            if (longest.length < 2) continue;
            const cells = longest.slice(Math.floor((longest.length - Math.min(3, longest.length)) / 2), Math.floor((longest.length - Math.min(3, longest.length)) / 2) + Math.min(3, longest.length));
            site = { roomId, x: cells.reduce((sum, i) => sum + i % width + .5, 0) / cells.length,
                y: cells.reduce((sum, i) => sum + Math.floor(i / width) + .5, 0) / cells.length,
                width: cells.length + .15, height: 1.4, angle: edge.angle, cells };
            break;
        }
        if (site) sites.push(site);
    }
    return sites;
}
