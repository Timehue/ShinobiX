import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerWorldPath, advancePeerPath } from './world-peer-motion';
import type { WorldNode } from '../../../shared/continuous-world-navigation';
const nodes = new Map<string, WorldNode>([
    ['a', { id: 'a', sector: 1, x: 0, y: 0, neighbors: ['b'] }],
    ['b', { id: 'b', sector: 1, x: 1, y: 0, neighbors: ['a', 'c'] }],
    ['c', { id: 'c', sector: 2, x: 1, y: 1, neighbors: ['b'] }],
    ['other', { id: 'other', sector: 3, x: .5, y: .5, neighbors: [] }],
]);
const cursor = (from: string, to: string, progress: number) => ({ layoutVersion: 'test', from, to, progress });
test('peer snapshots follow corners and exact partial edges without diagonal shortcuts', () => {
    const path = peerWorldPath(nodes, cursor('a', 'b', .5), cursor('b', 'c', .5))!;
    assert.deepEqual(advancePeerPath(path, .75), { x: 1, y: .25 });
    assert.deepEqual(advancePeerPath(path, 10), { x: 1, y: .5 });
    assert.equal(peerWorldPath(nodes, cursor('a', 'b', .5), cursor('other', 'other', 0)), null);
});
test('reversed partial-edge peer updates preserve the exact location', () => {
    const path = peerWorldPath(nodes, cursor('a', 'b', .75), cursor('b', 'a', .75))!;
    assert.deepEqual(advancePeerPath(path, .25), { x: .5, y: 0 });
});
