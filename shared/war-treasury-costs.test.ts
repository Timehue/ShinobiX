import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PREP_BONE_CHARMS_PER_WR, preparationBoneCharmsForWr, RYO_PER_WR, treasuryRyoForWr } from './war-treasury-costs.js';
import { RYO_PER_WR as SERVER_RYO_PER_WR } from '../api/_war-economy.js';

/*
 * Treasury ryo and Bone Charms on war escalation (2026-10 rebalance, #6): one
 * shared module, so the server that charges and the client that shows the
 * price can never drift apart.
 */

test('250 treasury ryo and half a Bone Charm per War Resource charged', () => {
    assert.equal(RYO_PER_WR, 250);
    assert.equal(PREP_BONE_CHARMS_PER_WR, 0.5);
    assert.equal(SERVER_RYO_PER_WR, RYO_PER_WR, 'the server re-exports the shared constant');
    assert.deepEqual([60, 110, 170, 280, 420].map((wr) => treasuryRyoForWr(wr)), [15_000, 27_500, 42_500, 70_000, 105_000]);
    assert.deepEqual([40, 80, 120].map((wr) => preparationBoneCharmsForWr(wr)), [20, 40, 60]);
});

test('a free hire stays free, and a rate of 0 turns both charges off', () => {
    assert.equal(treasuryRyoForWr(0), 0);
    assert.equal(treasuryRyoForWr(-5), 0);
    assert.equal(treasuryRyoForWr(Number.NaN), 0);
    assert.equal(treasuryRyoForWr(60, 0), 0);
    assert.equal(preparationBoneCharmsForWr(40, 0), 0);
    assert.equal(treasuryRyoForWr(60, 460), 27_600);
});
