import test from 'node:test';
import assert from 'node:assert/strict';

import { GRID_H, GRID_W } from '../combat-core/constants.js';
import { hexDistance } from '../combat-core/grid.js';
import { P1_START, P2_START } from './session.js';

test('PvP spawns are exact 180-degree mirrors with identical board reach', () => {
    assert.equal(P2_START, GRID_W * GRID_H - 1 - P1_START);
    assert.equal(hexDistance(P1_START, P2_START, GRID_W), 7);

    const p1Distances = Array.from({ length: GRID_W * GRID_H }, (_, tile) => hexDistance(P1_START, tile, GRID_W)).sort((a, b) => a - b);
    const p2Distances = Array.from({ length: GRID_W * GRID_H }, (_, tile) => hexDistance(P2_START, tile, GRID_W)).sort((a, b) => a - b);
    assert.deepEqual(p1Distances, p2Distances);
});
