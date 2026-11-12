import assert from "node:assert/strict";
import test from "node:test";
import { SECTOR_POINTS, SECTOR_ROAD_PAIRS, sectorExits } from "../../../shared/sector-links";
import { ATLAS_SECTOR_POINTS } from "./sector-points";

test("atlas clearance nudges do not mutate gameplay geography", () => {
    assert.equal(ATLAS_SECTOR_POINTS.length, SECTOR_POINTS.length);

    const gameplayEight = SECTOR_POINTS.find((point) => point.id === 8);
    const atlasEight = ATLAS_SECTOR_POINTS.find((point) => point.id === 8);
    assert.deepEqual(gameplayEight, { id: 8, x: 14, y: 72 });
    assert.deepEqual(atlasEight, { id: 8, x: 12, y: 72 });

    const gameplayFiftyFive = SECTOR_POINTS.find((point) => point.id === 55);
    const atlasFiftyFive = ATLAS_SECTOR_POINTS.find((point) => point.id === 55);
    assert.deepEqual(gameplayFiftyFive, { id: 55, x: 59, y: 60 });
    assert.deepEqual(atlasFiftyFive, { id: 55, x: 54, y: 57 });

    assert.deepEqual(SECTOR_POINTS.filter((point) => [17, 23, 24, 25].includes(point.id)), [
        { id: 17, x: 85, y: 77 }, { id: 23, x: 78, y: 70 },
        { id: 24, x: 88.5, y: 66 }, { id: 25, x: 76, y: 82 },
    ], 'opening the village court must preserve the authoritative road geography');

    // Around Cinderhold's cone (2026-11-11) the older neighbours step aside on
    // the atlas and Death's Gate moves to open hills. Cinderhold's own sectors
    // sit at their real positions. Travel keeps the graph.
    const coneNudges = [13, 36, 37, 58, 59, 60, 99];
    assert.deepEqual(SECTOR_POINTS.find((point) => point.id === 99), { id: 99, x: 52, y: 21 }, 'Death’s Gate keeps its gameplay point');
    assert.deepEqual(ATLAS_SECTOR_POINTS.find((point) => point.id === 99), { id: 99, x: 83, y: 42 });
    for (const gameplayPoint of SECTOR_POINTS) {
        const atlasPoint = ATLAS_SECTOR_POINTS.find((point) => point.id === gameplayPoint.id);
        assert.ok(atlasPoint, `atlas is missing sector ${gameplayPoint.id}`);
        if (![8, 17, 23, 24, 25, 55, ...coneNudges].includes(gameplayPoint.id)) assert.deepEqual(atlasPoint, gameplayPoint);
    }
});

// Cinderhold and the neighbours nudged around it.
const CONE = new Set([13, 36, 37, 58, 59, 60, 67, 68, 69, 70, 71, 72, 73, 74, 99]);

test("around the cone, every road leaves a sector on the map the way its floor paints that exit", () => {
    const atlas = new Map(ATLAS_SECTOR_POINTS.map((point) => [point.id, point]));
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        if (!CONE.has(a) && !CONE.has(b)) continue;
        for (const [from, to] of [[a, b], [b, a]] as const) {
            const painted = sectorExits(from).find((exit) => exit.destinationSector === to)?.direction;
            // On screen the board is 16:9, so compare the drawn road in those proportions.
            const p = atlas.get(from)!, q = atlas.get(to)!, dx = (q.x - p.x) * 16, dy = (q.y - p.y) * 9;
            const shown = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "east" : "west") : (dy >= 0 ? "south" : "north");
            assert.equal(shown, painted, `the map draws ${from}->${to} leaving ${shown}; its floor paints it ${painted}`);
        }
    }
});

test("no two atlas pins around the cone sit closer than a clear gap on the 1366px board", () => {
    // The board is 854x475 at a 1366x768 window; a pin is 28px (Death's Gate 36px).
    const W = 854, H = 475, gap = 8;
    for (const a of ATLAS_SECTOR_POINTS) {
        if (!CONE.has(a.id)) continue;
        for (const b of ATLAS_SECTOR_POINTS) {
            if (a.id === b.id) continue;
            const distance = Math.hypot((a.x - b.x) / 100 * W, (a.y - b.y) / 100 * H);
            const radii = (a.id === 99 ? 18 : 14) + (b.id === 99 ? 18 : 14);
            assert.ok(distance - radii >= gap, `pins ${a.id} and ${b.id} are ${Math.round(distance - radii)}px apart`);
        }
    }
});
