import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectorRoadRoutes } from './sector-road-routes.mjs';

test('a nearby pair of exits does not paint the unused construction hub or its spur', () => {
    const layout = { sector: 34, mask: Array.from({ length: 12 }, (_, row) => [4, 5].includes(row) ? '=======#####' : '############'),
        exits: [{ tile: 48 }, { tile: 60 }], sites: {} };
    assert.deepEqual([...new Set(sectorRoadRoutes(layout).flat())].sort((a, b) => a - b), [48, 60]);
});

test('permanent landmark entrances join the network; quest rifts do not author road spurs', () => {
    const layout = { sector: 1, mask: Array.from({ length: 12 }, (_, row) => row === 5 ? '============' : row === 6 ? '######=#####' : '############'),
        exits: [{ tile: 60 }, { tile: 71 }], sites: { shrine: { approach: 78 }, rift: { approach: 5 } } };
    const road = new Set(sectorRoadRoutes(layout).flat());
    assert.ok(road.has(78)); assert.equal(road.has(5), false);
    assert.throws(() => sectorRoadRoutes({ ...layout, sites: { shrine: { approach: 79 } } }), /Disconnected road destination/);
});
