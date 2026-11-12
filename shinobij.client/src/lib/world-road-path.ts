/**
 * The world-map road line between two sector pins.
 *
 * A road leaves each pin along the side its sector floor paints that exit on
 * (north, south, east or west), then curves to meet the other pin from that
 * pin's painted side. That is what a player sees on the board when they walk
 * the road, so the map and the floor always agree, without moving any pin.
 *
 * Before 2026-11-12 the line was a gentle arc straight from pin to pin. On the
 * 16:9 board, 14 roads then left a pin on a different side than their floor
 * paints the exit: the exit side is decided in raw map percent, but a 1% step
 * across is wider on screen than a 1% step down (e.g. 11 -> 15 is painted
 * south, while the pin sits further right than down on screen).
 */
import { SECTOR_ROAD_PAIRS, sectorExits } from '../../../shared/sector-links';

export type RoadSide = 'north' | 'south' | 'east' | 'west';
export type MapPoint = { x: number; y: number };

/**
 * Sideways bow (on-screen 16:9 units) for the roads whose plain curve would run
 * under a third pin and read as passing through it: 21-24 past 22, 49-50 past 55.
 * Only these numbers ship; world-road-path.test.ts re-derives the smallest
 * clearing bow for every road and fails if this table goes stale.
 */
export const ROAD_BOWS: Readonly<Record<string, number>> = { '21-24': -40, '49-50': 32 };

/**
 * The cubic Bezier's control points. Each end's handle points along its painted
 * side for 38% of the road's on-screen length (the board is drawn 16:9); `bow`
 * pushes both handles sideways off the chord without turning either off its side.
 */
export function worldRoadControls(a: MapPoint, b: MapPoint, leaveA: RoadSide, leaveB: RoadSide, bow = 0): [MapPoint, MapPoint] {
    const dx = (b.x - a.x) * 16, dy = (b.y - a.y) * 9, chord = Math.hypot(dx, dy) || 1, length = chord * .38;
    const handle = (p: MapPoint, side: RoadSide): MapPoint => ({
        x: +(p.x + ((side === 'east' ? length : side === 'west' ? -length : 0) - dy / chord * bow) / 16).toFixed(2),
        y: +(p.y + ((side === 'south' ? length : side === 'north' ? -length : 0) + dx / chord * bow) / 9).toFixed(2),
    });
    return [handle(a, leaveA), handle(b, leaveB)];
}

/** SVG path data in the board's 0-100 percent space. */
export function worldRoadPath(a: MapPoint, b: MapPoint, leaveA: RoadSide, leaveB: RoadSide, bow = 0): string {
    const [c1, c2] = worldRoadControls(a, b, leaveA, leaveB, bow);
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/** Every road the world map draws: one line per road pair, between the atlas pins. */
export function worldMapRoads(points: ReadonlyArray<MapPoint & { id: number }>): { id: string; a: number; b: number; d: string }[] {
    const pin = new Map(points.map((p) => [p.id, p]));
    const side = (from: number, to: number) => sectorExits(from).find((exit) => exit.destinationSector === to)?.direction;
    return SECTOR_ROAD_PAIRS.flatMap(([a, b]) => {
        const pa = pin.get(a), pb = pin.get(b), leaveA = side(a, b), leaveB = side(b, a), id = `${a}-${b}`;
        return pa && pb && leaveA && leaveB ? [{ id, a, b, d: worldRoadPath(pa, pb, leaveA, leaveB, ROAD_BOWS[id]) }] : [];
    });
}
