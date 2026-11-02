import assert from 'node:assert/strict';
import test from 'node:test';
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES, resourceNodeAtLevel, resourceNodeOffer, RETIRED_RESOURCE_NODE_IDS, resourceNode } from './resource-nodes.js';
import { RESOURCE_REFILL_MS } from './resource-gathering.js';

const START = Date.parse('2026-11-01T00:00:00Z');
const cycles = Array.from({ length: 200 }, (_, i) => START + i * RESOURCE_REFILL_MS);
const sites = (activity: string) => RESOURCE_NODES.filter(node => node.activity === activity);
const counts = (activity: string, at: number) => {
    const levels = sites(activity).map(node => resourceNodeOffer(node, at).difficulty);
    return [1, 4, 7].map(level => levels.filter(value => value === level).length);
};

for (const activity of ['mining', 'fishing']) {
    test(`every cycle deals half of ${activity} at level 1 and splits the rest between 4 and 7`, () => {
        const total = sites(activity).length;
        for (const at of cycles) {
            const [basic, rich, master] = counts(activity, at);
            assert.equal(basic, Math.ceil(total / 2));
            assert.ok(Math.abs(rich - master) <= 1);
        }
    });
}

test('a site holds its level within a cycle and every site visits every level', () => {
    const at = cycles[3];
    for (const node of RESOURCE_NODES) {
        assert.equal(resourceNodeOffer(node, at + RESOURCE_REFILL_MS - 1).difficulty, resourceNodeOffer(node, at).difficulty, node.id);
        assert.deepEqual([...new Set(cycles.map(time => resourceNodeOffer(node, time).difficulty))].sort(), [1, 4, 7], node.id);
    }
});

test('the deal changes between cycles and pins one exact deal, because client and server must agree', () => {
    const levels = (at: number) => RESOURCE_NODES.map(node => resourceNodeOffer(node, at).difficulty).join('');
    assert.notEqual(levels(cycles[0]), levels(cycles[1]));
    assert.equal(levels(cycles[0]), levels(cycles[0] + 1000));
    assert.equal(levels(START).slice(0, 16), '7714111117477111');
});

test('offered rewards follow the offered level, and a seam keeps its biome trace', () => {
    const snow = RESOURCE_NODES.find(node => node.activity === 'mining' && node.trace === 'gather-rime-crystal')!;
    assert.deepEqual([1, 4, 7].map(level => {
        const offer = resourceNodeAtLevel(snow, level as 1 | 4 | 7);
        return [offer.difficulty, offer.ceiling, offer.trace];
    }), [[1, 1, undefined], [4, 2, 'gather-rime-crystal'], [7, 3, 'gather-rime-crystal']]);
    const shoal = sites('fishing')[0];
    assert.equal(resourceNodeAtLevel(shoal, 7).trace, undefined);
    assert.equal(resourceNodeAtLevel(shoal, 7).family, shoal.family);
});

test('event crystals and retired sites keep their fixed rules', () => {
    for (const node of [...WORLD_BOSS_CRYSTAL_NODES, ...RETIRED_RESOURCE_NODE_IDS.map(id => resourceNode(id)!)])
        for (const at of cycles.slice(0, 20)) assert.deepEqual(resourceNodeOffer(node, at), node);
});
