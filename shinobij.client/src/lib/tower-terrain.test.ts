import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { towerTerrainPatches } from './tower-terrain';
import { HEX_H, HEX_W, towerHexPixel } from './tower-grid';

test('terrain art preserves disconnected hazard footprints without painting intervening safe cells', () => {
    const tiles = [0, 1, 18, 214, 215];
    const patches = towerTerrainPatches(tiles, 18, 12);
    assert.equal(patches.length, 2);
    assert.deepEqual(patches.flatMap(patch => patch.tiles).sort((a, b) => a - b), tiles);
    for (const patch of patches) {
        assert.equal(patch.tiles.length, patch.polygons.length);
        patch.tiles.forEach((tile, index) => {
            const pixel = towerHexPixel(tile, 18);
            const points = patch.polygons[index]!.split(' ').map(point => point.split(',').map(Number));
            assert.equal(points.length, 6);
            assert.equal(Math.min(...points.map(point => point[0]!)) + patch.left, pixel.left);
            assert.equal(Math.max(...points.map(point => point[0]!)) + patch.left, pixel.left + HEX_W);
            assert.ok(Math.min(...points.map(point => point[1]!)) + patch.top >= pixel.top);
            assert.ok(Math.max(...points.map(point => point[1]!)) + patch.top <= pixel.top + HEX_H);
        });
    }
});

test('invalid and duplicate tiles cannot create extra terrain outside the arena', () => {
    const patches = towerTerrainPatches([-1, 0, 0, 216, 999, NaN, 1.5], 18, 12);
    assert.deepEqual(patches.flatMap(patch => patch.tiles), [0]);
    assert.deepEqual(towerTerrainPatches([], 18, 12), []);
});
