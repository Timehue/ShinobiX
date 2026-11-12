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

const STEP: Record<RoadSide, readonly [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
/** On-screen proportions of the map board (it is drawn 16:9 on desktop). */
export const MAP_ASPECT = { x: 16, y: 9 } as const;
/** How far each end runs along its painted side, as a share of the road's on-screen length. */
const HANDLE = 0.38;

const round = (n: number) => Number(n.toFixed(2));

/**
 * The cubic Bezier's control points: each end's handle points along its painted
 * side. `bow` (on-screen units) pushes both handles sideways off the chord, to
 * carry the line around a pin that sits on it; it never turns a handle off its side.
 */
export function worldRoadControls(a: MapPoint, b: MapPoint, leaveA: RoadSide, leaveB: RoadSide, bow = 0): [MapPoint, MapPoint] {
    const dx = (b.x - a.x) * MAP_ASPECT.x, dy = (b.y - a.y) * MAP_ASPECT.y, chord = Math.hypot(dx, dy) || 1;
    const length = chord * HANDLE, nx = -dy / chord * bow, ny = dx / chord * bow;
    const handle = (p: MapPoint, side: RoadSide): MapPoint => ({
        x: round(p.x + (STEP[side][0] * length + nx) / MAP_ASPECT.x),
        y: round(p.y + (STEP[side][1] * length + ny) / MAP_ASPECT.y),
    });
    return [handle(a, leaveA), handle(b, leaveB)];
}

/** SVG path data in the board's 0-100 percent space. */
export function worldRoadPath(a: MapPoint, b: MapPoint, leaveA: RoadSide, leaveB: RoadSide, bow = 0): string {
    const [c1, c2] = worldRoadControls(a, b, leaveA, leaveB, bow);
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/** Points along a drawn road, for clearance checks. */
export function worldRoadSamples(a: MapPoint, b: MapPoint, c1: MapPoint, c2: MapPoint, steps = 100): MapPoint[] {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps, u = 1 - t;
        return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
    });
}

/** On-screen distance (16:9 units) within which a line reads as running under a pin: ~15px on the 1366 board. */
export const PIN_CLEARANCE = 30;
const screenGap = (p: MapPoint, q: MapPoint) => Math.hypot((p.x - q.x) * MAP_ASPECT.x, (p.y - q.y) * MAP_ASPECT.y);

/** Every road the world map draws: one line per road pair, between the atlas pins. */
export function worldMapRoads(points: ReadonlyArray<MapPoint & { id: number }>): { id: string; a: number; b: number; d: string }[] {
    const pin = new Map(points.map((p) => [p.id, p]));
    const side = (from: number, to: number) => sectorExits(from).find((exit) => exit.destinationSector === to)?.direction;
    return SECTOR_ROAD_PAIRS.flatMap(([a, b]) => {
        const pa = pin.get(a), pb = pin.get(b), leaveA = side(a, b), leaveB = side(b, a);
        if (!pa || !pb || !leaveA || !leaveB) return [];
        // A road must not read as passing through a third sector: bow it around
        // any pin on its line (21-24 past 22, 49-50 past 55), the smaller way first.
        const others = points.filter((p) => p.id !== a && p.id !== b);
        const clear = (bow: number) => { const [c1, c2] = worldRoadControls(pa, pb, leaveA, leaveB, bow);
            return worldRoadSamples(pa, pb, c1, c2).every((s) => others.every((p) => screenGap(s, p) >= PIN_CLEARANCE)); };
        let bow = 0;
        if (!clear(0)) for (let step = 8; step <= 160; step += 8) { if (clear(step)) { bow = step; break; } if (clear(-step)) { bow = -step; break; } }
        return [{ id: `${a}-${b}`, a, b, d: worldRoadPath(pa, pb, leaveA, leaveB, bow) }];
    });
}
