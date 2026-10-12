import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrongholdTiles, canStepStronghold, STRONGHOLD_DIMS, STRONGHOLD_SPAWN, STRONGHOLD_VAULT, STRONGHOLD_ROOMS, strongholdSafeTile } from './sector-stronghold';
import { planUndergroundFloorFeatures } from './underground-floor-features';
import { undergroundFeatureBlocks } from './underground-floor-collision';
import { generateHollowGateFloor } from '../shinobij.client/src/lib/hollow-gate-generate';
import { projectHollowGateMovement } from '../shinobij.client/src/lib/hollow-gate-movement-projection';
import { findHollowGatePath } from '../shinobij.client/src/lib/hollow-gate-path';

for (const sector of [12, 99]) test(`sector ${sector}: collision reserves every doorway and keeps all twelve rooms reachable`, () => {
    const tiles = buildStrongholdTiles(sector), width = STRONGHOLD_DIMS.width, queue = [STRONGHOLD_SPAWN], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const next of [queue[i] - width, queue[i] + 1, queue[i] + width, queue[i] - 1]) if (!seen.has(next) && canStepStronghold(queue[i], next, sector)) { seen.add(next); queue.push(next); }
    for (const room of STRONGHOLD_ROOMS) assert(tiles.some((tile, index) => tile.roomId === room.id && seen.has(index)), room.name);
    assert(tiles.filter(t => t.solid).length > 20);
    for (let index = 0; index < tiles.length; index++) {
        if (tiles[index].solid) { assert(!canStepStronghold(index - 1, index, sector)); assert.notEqual(tiles[index].terrain, 'door'); assert.equal(tiles[index].kind, 'empty'); assert(!tiles[strongholdSafeTile(index, sector)].solid); }
        if (tiles[index].terrain === 'door') assert(seen.has(index));
    }
    assert(seen.has(STRONGHOLD_VAULT - 1)); assert(!canStepStronghold(-1, 0, sector));
    tiles[STRONGHOLD_SPAWN].solid = true; assert(!buildStrongholdTiles(sector)[STRONGHOLD_SPAWN].solid, 'cached templates cannot be changed by callers');
});

test('cave features preserve all nodes across standard and Rift shapes; manual and tap movement cannot cross them', () => {
    let inspected = 0;
    for (let seed = 0; seed < 12; seed++) for (const floor of [1, 2, 3, 4, 5]) for (const shape of [undefined, { width: 19, height: 15 }]) {
        let value = seed + 500; const rng = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
        const run = generateHollowGateFloor(floor, floor === 5, shape, rng), spawn = run.playerY * run.width + run.playerX;
        run.floorFeatures = planUndergroundFloorFeatures(run.tiles, run.width, true, false, spawn);
        const all = new Set(run.tiles.map((_, index) => index));
        for (const feature of run.floorFeatures) for (const index of feature.cells) {
            inspected++; assert.equal(run.tiles[index].kind, 'empty'); assert.notEqual(run.tiles[index].terrain, 'door'); assert.notEqual(index, spawn);
            assert.equal(findHollowGatePath(run, index, all), null);
            const from = [index - run.width, index + 1, index + run.width, index - 1].find(n => run.tiles[n]?.kind === 'empty' && !undergroundFeatureBlocks(run.floorFeatures, n) && Math.abs(n % run.width - index % run.width) + Math.abs(Math.floor(n / run.width) - Math.floor(index / run.width)) === 1);
            if (from != null) { const current = { ...run, playerX: from % run.width, playerY: Math.floor(from / run.width) }; const projected = projectHollowGateMovement(current, index % run.width - current.playerX, Math.floor(index / run.width) - current.playerY)!; assert(projected.effect.wallBump); assert.equal(projected.nextRun, current); assert.equal(projected.effect.step, undefined); }
        }
        for (let index = 0; index < run.tiles.length; index++) if (run.tiles[index].kind !== 'empty' && run.tiles[index].kind !== 'wall') assert(findHollowGatePath(run, index, all), `${seed}/${floor}: ${run.tiles[index].kind}`);
    }
    assert(inspected > 100);
});
