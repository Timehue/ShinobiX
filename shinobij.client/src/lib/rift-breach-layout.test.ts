import assert from 'node:assert/strict';
import { test } from 'node:test';
import { riftBreachSites } from './rift-breach-layout';
import { generateHollowGateFloor } from './hollow-gate-generate';
import { computeHollowGateVisible } from './hollow-gate-visibility';
import { hollowGateVariantDims, variantFromEventConfig } from './hollow-gate-variant';
import { riftEventConfig } from './rift-run';
import { hollowRifts } from '../data/hollow-rifts';

test('authored rifts expose a breach at arrival without covering any walkable tile or doorway', () => {
    for (const rift of hollowRifts) for (let floor = 1; floor <= rift.floors; floor++) for (let seed = 1; seed <= 10; seed++) {
        let state = seed;
        const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
        const dims = hollowGateVariantDims(variantFromEventConfig(riftEventConfig(rift)));
        const run = generateHollowGateFloor(floor, floor === rift.floors, dims, random);
        const visible = computeHollowGateVisible(run), sites = riftBreachSites(run.tiles, run.width);
        const entryRoom = run.tiles[run.playerY * run.width + run.playerX].roomId;
        assert(sites.some(site => site.roomId === entryRoom && site.cells.every(i => visible.has(i))), `${rift.id}, floor ${floor}, seed ${seed} has a visible arrival breach`);
        for (const site of sites) {
            assert(site.cells.length >= 2);
            assert(site.cells.every(i => run.tiles[i]?.kind === 'wall'), 'the physical breach sits in authoritative solid stone');
        }
    }
});

test('a completely open boundary does not invent an impassable breach', () => {
    const tiles = Array.from({ length: 25 }, (_, i) => ({ kind: 'empty', roomId: i >= 6 && i <= 18 ? 0 : null }));
    assert.deepEqual(riftBreachSites(tiles, 5), []);
});
