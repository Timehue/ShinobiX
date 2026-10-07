import test from 'node:test';
import assert from 'node:assert/strict';
import { isWalkableTile, nearestInMask, nearestWalkableTile, pathInMask, tileNeighbors, walkableTiles, walkPath } from './sector-walk-mask.js';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';

test('unmasked sectors preserve all valid tiles, including boundary tiles', () => {
    assert.deepEqual(walkableTiles(31, false), Array.from({ length: 144 }, (_, tile) => tile));
    for (const tile of [-1, 144, .5, NaN]) assert.equal(isWalkableTile(31, tile), false);
    assert.deepEqual(tileNeighbors(11), [10, 23]);
});

test('paths go around a solid footprint using cardinal steps, without row wrapping', () => {
    const mask = Array.from({ length: 12 }, () => '............');
    mask[5] = '....BBBB....';
    const path = pathInMask(mask, 63, 68)!;
    assert.ok(path.length > 6);
    assert.equal(path[0], 63); assert.equal(path.at(-1), 68);
    for (let index = 1; index < path.length; index++) assert.ok(tileNeighbors(path[index - 1]!).includes(path[index]!));
    assert.equal(pathInMask(mask, 64, 68), null);
});

test('blocked destinations snap deterministically, and disconnected islands have no path', () => {
    const mask = Array.from({ length: 12 }, () => '############');
    mask[4] = '.....#......'; mask[5] = '.....#......';
    assert.equal(nearestInMask(mask, 65), 64);
    assert.equal(pathInMask(mask, 64, 66), null);
    assert.equal(nearestInMask(undefined, 143), 143);
});

test('every tile tap in every admitted sector resolves to reachable open ground', () => {
    for (const layout of Object.values(SECTOR_FLOOR_LAYOUTS)) {
        const start = walkableTiles(layout.sector)[0]!;
        for (let tile = 0; tile < 144; tile++) {
            const destination = nearestWalkableTile(layout.sector, tile);
            assert.ok(isWalkableTile(layout.sector, destination), `${layout.sector}:${tile}`);
            assert.ok(walkPath(layout.sector, start, destination), `${layout.sector}:${tile} unreachable`);
            assert.equal(nearestWalkableTile(layout.sector, tile, false), tile);
        }
    }
});
