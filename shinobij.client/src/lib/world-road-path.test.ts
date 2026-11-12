import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_ROAD_PAIRS, sectorExits } from '../../../shared/sector-links';
import { ATLAS_SECTOR_POINTS } from '../data/sector-points';
import { ROAD_BOWS, worldMapRoads, worldRoadControls, worldRoadPath, type MapPoint, type RoadSide } from './world-road-path';

const MAP_ASPECT = { x: 16, y: 9 };
/** On-screen distance (16:9 units) within which a line reads as running under a pin: ~15px on the 1366 board. */
const PIN_CLEARANCE = 30;
const pin = new Map(ATLAS_SECTOR_POINTS.map((p) => [p.id, p]));
function worldRoadSamples(a: MapPoint, b: MapPoint, c1: MapPoint, c2: MapPoint, steps = 100): MapPoint[] {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps, u = 1 - t;
        return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
            y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
    });
}
const underAPin = (a: MapPoint, b: MapPoint, c1: MapPoint, c2: MapPoint, ends: readonly number[]) =>
    ATLAS_SECTOR_POINTS.filter((p) => !ends.includes(p.id) && worldRoadSamples(a, b, c1, c2)
        .some((s) => Math.hypot((s.x - p.x) * MAP_ASPECT.x, (s.y - p.y) * MAP_ASPECT.y) < PIN_CLEARANCE)).map((p) => p.id);
const painted = (from: number, to: number) => sectorExits(from).find((exit) => exit.destinationSector === to)?.direction;
/** Which side of `from` a handle at `to` sits on, in on-screen proportions. */
const side = (from: MapPoint, to: MapPoint): RoadSide => {
    const dx = (to.x - from.x) * MAP_ASPECT.x, dy = (to.y - from.y) * MAP_ASPECT.y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north');
};

test('every road on the world map leaves both pins on the side their floors paint that exit', () => {
    const drawn = worldMapRoads(ATLAS_SECTOR_POINTS);
    assert.equal(drawn.length, SECTOR_ROAD_PAIRS.length, 'every road is drawn');
    const wrong: string[] = [];
    for (const road of drawn) {
        const pa = pin.get(road.a)!, pb = pin.get(road.b)!;
        // Read the handles back out of the path the overlay actually draws.
        const [, mx, my, c1x, c1y, c2x, c2y, ex, ey] = /^M (\S+) (\S+) C (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(road.d)!.map(Number);
        assert.deepEqual([mx, my, ex, ey], [pa.x, pa.y, pb.x, pb.y], `${road.id} runs pin to pin`);
        const leaves = side(pa, { x: c1x!, y: c1y! }), arrives = side(pb, { x: c2x!, y: c2y! });
        if (leaves !== painted(road.a, road.b)) wrong.push(`${road.a}->${road.b}: leaves ${leaves}, painted ${painted(road.a, road.b)}`);
        if (arrives !== painted(road.b, road.a)) wrong.push(`${road.b}->${road.a}: leaves ${arrives}, painted ${painted(road.b, road.a)}`);
    }
    assert.deepEqual(wrong, []);
});

test('no road is painted to leave a pin directly away from the pin it reaches, so no line loops back', () => {
    const opposite: Record<RoadSide, RoadSide> = { north: 'south', south: 'north', east: 'west', west: 'east' };
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        const pa = pin.get(a)!, pb = pin.get(b)!;
        assert.notEqual(painted(a, b), opposite[side(pa, pb)], `${a}->${b} leaves away from ${b}`);
    }
});

test('no road line runs under a third sector pin, so none reads as passing through it', () => {
    const under: string[] = [];
    for (const road of worldMapRoads(ATLAS_SECTOR_POINTS)) {
        const n = /^M (\S+) (\S+) C (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(road.d)!.slice(1).map(Number);
        for (const id of underAPin({ x: n[0]!, y: n[1]! }, { x: n[6]!, y: n[7]! }, { x: n[2]!, y: n[3]! }, { x: n[4]!, y: n[5]! }, [road.a, road.b]))
            under.push(`${road.id} under pin ${id}`);
    }
    assert.deepEqual(under, []);
});

test('the shipped bow table is exactly the smallest clearing bow each road needs', () => {
    // The search the bundle no longer carries: no bow if the plain curve clears
    // every pin, else the first of +-8, +-16, ... that does (smaller way first).
    const derived: Record<string, number> = {};
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        const pa = pin.get(a)!, pb = pin.get(b)!, la = painted(a, b)!, lb = painted(b, a)!;
        const clear = (bow: number) => { const [c1, c2] = worldRoadControls(pa, pb, la, lb, bow); return underAPin(pa, pb, c1, c2, [a, b]).length === 0; };
        if (clear(0)) continue;
        let found = 0;
        for (let step = 8; step <= 160 && !found; step += 8) found = clear(step) ? step : clear(-step) ? -step : 0;
        assert.notEqual(found, 0, `${a}-${b}: no bow up to 160 clears its pins`);
        derived[`${a}-${b}`] = found;
    }
    assert.deepEqual(ROAD_BOWS, derived);
});

test('a road between two pins on one line stays a straight line', () => {
    assert.equal(worldRoadPath({ x: 10, y: 20 }, { x: 30, y: 20 }, 'east', 'west'), 'M 10 20 C 17.6 20 22.4 20 30 20');
});
