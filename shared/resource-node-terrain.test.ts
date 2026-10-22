import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES, RETIRED_RESOURCE_NODE_IDS, resourceNode, resourceNodePosition, validResourceNodeTerrain } from './resource-nodes';

const review = JSON.parse(readFileSync(new URL('./resource-node-review.json', import.meta.url), 'utf8')) as {
    nodes: { id: string; sector: number; approach: number; target: number; difficulty: number; ceiling: number; family: string; trace?: string }[];
    paintings: { file: string; sha256: string }[];
};
test('terrain review remains tied to the actual sector paintings, including live painted variants', () => {
    for (const { file, sha256 } of review.paintings) {
        assert.equal(createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex'), sha256,
            `${file}: artwork changed; review rock and water placements before accepting this painting`);
    }
});
test('all historical IDs preserve their saved locations and reward rules', () => {
    assert.equal(review.nodes.length, 151);
    for (const former of review.nodes) {
        const live = resourceNode(former.id)!;
        assert.ok(live, former.id);
        for (const key of Object.keys(former) as (keyof typeof former)[]) assert.equal(live[key], former[key], `${former.id}: ${key}`);
    }
});
test('navigation obstacles do not authorize mining on buildings, even under a new ID', () => {
    for (const id of RETIRED_RESOURCE_NODE_IDS) {
        const former = resourceNode(id)!;
        assert.equal(validResourceNodeTerrain({ ...former, id: 'future-node' }), false, id);
    }
    for (const fish of RESOURCE_NODES.filter(n => n.activity === 'fishing')) {
        assert.equal(validResourceNodeTerrain({ ...fish, activity: 'mining' }), false, fish.id);
    }
    for (const mine of [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES].filter(n => n.activity === 'mining')) {
        assert.equal(validResourceNodeTerrain(mine), true, mine.id);
        assert.equal(validResourceNodeTerrain({ ...mine, activity: 'fishing' }), false, mine.id);
    }
});
test('snowy crystal marker sits on the reviewed rock face within its original tile', () => {
    const node = resourceNode('world-boss-crystal-30-2')!, position = resourceNodePosition(node);
    assert.deepEqual(node.markerOffset, [.75, .25]);
    assert.equal(Math.floor(position.left / 100 * 12), node.target % 12);
    assert.equal(Math.floor(position.top / 100 * 12), Math.floor(node.target / 12));
});
