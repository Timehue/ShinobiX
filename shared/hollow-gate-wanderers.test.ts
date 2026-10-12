import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceHollowGateWanderers, createHollowGateWanderers, type HollowGateWanderer } from './hollow-gate-wanderers.js';

const board = { floor: 1, width: 7, height: 5, spawn: { x: 1, y: 1 }, walkable: [
    '0000000', '0111110', '0100010', '0111110', '0000000',
].join(''), nodes: {} as Record<string, string> };
test('hunter shortest path goes around solid stone; travelers cannot cover event nodes', () => {
    const hunter: HollowGateWanderer = { role: 'night-ninja', nodeId: 'floor:1:tile:12', origin: 12, tile: 12 };
    let npcs = [hunter];
    for (let step = 2; step <= 12; step += 2) {
        const before = npcs[0].tile;
        npcs = advanceHollowGateWanderers(board, npcs, { x: 1, y: 3 }, step);
        assert.equal(board.walkable[npcs[0].tile], '1');
        assert(Math.abs(before % 7 - npcs[0].tile % 7) + Math.abs(Math.floor(before / 7) - Math.floor(npcs[0].tile / 7)) <= 1);
    }
    assert.equal(npcs[0].tile, 23, 'hunter reaches the tile beside the player by the open corridor');
    const medic: HollowGateWanderer = { ...hunter, role: 'medic', tile: 9 };
    const withChest = { ...board, nodes: { '10': 'chest', '8': 'descend' } };
    for (let step = 4; step < 60; step += 4) {
        const moved = advanceHollowGateWanderers(withChest, [medic], { x: 5, y: 3 }, step)[0];
        assert.notEqual(moved.tile, 10); assert.notEqual(moved.tile, 8);
    }
});
test('withdrawn hunters stop pursuit until approached again; spent actors and adjacent helpers stay put', () => {
    const npc: HollowGateWanderer = { role: 'night-ninja', nodeId: 'floor:1:tile:12', origin: 12, tile: 12 };
    const escaped = advanceHollowGateWanderers(board, [npc], { x: 1, y: 3 }, 2, ['1:battle:floor:1:tile:12']);
    assert.equal(escaped[0].tile, 12); assert.equal(escaped[0].hunting, false);
    assert.deepEqual(advanceHollowGateWanderers(board, [{ ...npc, spent: true }], { x: 1, y: 3 }, 2)[0], { ...npc, spent: true });
    const helper = { ...npc, role: 'medic' as const, tile: 9 };
    assert.equal(advanceHollowGateWanderers(board, [helper], { x: 1, y: 1 }, 4)[0].tile, 9);
});
test('sparse legacy boards can seal a smaller roster without adding unbound combat or blocking spawn', () => {
    assert.deepEqual(createHollowGateWanderers({ ...board, nodes: { '12': 'boss', '22': 'exit' } }, 'seed').filter(n => n.role !== 'medic' && n.role !== 'wayfarer'), []);
});
