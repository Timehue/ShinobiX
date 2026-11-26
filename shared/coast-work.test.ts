import assert from 'node:assert/strict';
import test from 'node:test';
import { COAST_JOBS } from './coast-work.js';
import { COAST_RESOURCE_NODES } from './coast-resource-nodes.js';
import { coastExits, coastLayout, coastSite } from './coast-world.js';
import { pathInMask, walkableInMask } from './sector-walk-mask.js';
import { resourceNode, resourceNodeOffer } from './resource-nodes.js';
import { questSite } from './quest-sites.js';
import { COAST_NET_RACK } from './sector-buildings.js';

function reachable(sector: number, tile: number) {
    const mask = coastLayout(sector)!.mask;
    assert.ok(walkableInMask(mask, tile), 'Standing cell ' + sector + '/' + tile);
    for (const exit of coastExits(sector)) assert.ok(pathInMask(mask, exit.tile, tile), exit.id + ' to ' + tile);
}
test('all coast profession nodes have stable ordinary identities and reachable work surfaces', () => {
    assert.deepEqual(['fishing','mining','harvesting'].map(activity => COAST_RESOURCE_NODES.filter(node => node.activity === activity).length), [7,4,7]);
    assert.equal(new Set(COAST_RESOURCE_NODES.map(node => node.id)).size, 18);
    for (const node of COAST_RESOURCE_NODES) {
        assert.equal(resourceNode(node.id), node);
        assert.equal(questSite(node.id), undefined);
        assert.equal(coastSite(node.siteId)?.sector, node.sector);
        assert.equal(resourceNodeOffer(node, Date.UTC(2026, 10, 25)).family, node.family);
        assert.equal(resourceNodeOffer(node, 0).difficulty, node.difficulty);
        reachable(node.sector, node.approach);
        assert.equal(Math.abs(node.target % 12 - node.approach % 12) + Math.abs(Math.floor(node.target / 12) - Math.floor(node.approach / 12)), 1);
        assert.ok(!coastExits(node.sector).some(exit => exit.tile === node.target || exit.tile === node.approach));
    }
});
test('every resident station and fieldwork step is reachable from each entrance', () => {
    for (const job of COAST_JOBS) {
        reachable(job.steps[0].sector, job.workerTile);
        for (const step of job.steps) reachable(step.sector, step.tile);
    }
    reachable(COAST_NET_RACK.sector, COAST_NET_RACK.approach);
});
