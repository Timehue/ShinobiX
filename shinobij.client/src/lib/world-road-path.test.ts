import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_ROAD_PAIRS, sectorExits } from '../../../shared/sector-links';
import { ATLAS_SECTOR_POINTS } from '../data/sector-points';
import { MAP_ASPECT, PIN_CLEARANCE, worldMapRoads, worldRoadPath, worldRoadSamples, type MapPoint, type RoadSide } from './world-road-path';

const pin = new Map(ATLAS_SECTOR_POINTS.map((p) => [p.id, p]));
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
        const line = worldRoadSamples({ x: n[0]!, y: n[1]! }, { x: n[6]!, y: n[7]! }, { x: n[2]!, y: n[3]! }, { x: n[4]!, y: n[5]! });
        for (const p of ATLAS_SECTOR_POINTS) {
            if (p.id === road.a || p.id === road.b) continue;
            const gap = Math.min(...line.map((s) => Math.hypot((s.x - p.x) * MAP_ASPECT.x, (s.y - p.y) * MAP_ASPECT.y)));
            if (gap < PIN_CLEARANCE) under.push(`${road.id} under pin ${p.id}`);
        }
    }
    assert.deepEqual(under, []);
});

test('a road between two pins on one line stays a straight line', () => {
    assert.equal(worldRoadPath({ x: 10, y: 20 }, { x: 30, y: 20 }, 'east', 'west'), 'M 10 20 C 17.6 20 22.4 20 30 20');
});
