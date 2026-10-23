import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petGauntletRyoSchedule } from './pet-gauntlet-economy.js';

test('the Gauntlet pays its original schedule from L70, where the anchor plateaus', () => {
    for (const level of [70, 85, 90, 100]) {
        assert.deepEqual(petGauntletRyoSchedule(level), { perRound: 250, clearBonus: 1_500, entryFee: 1_500 }, `L${level}`);
    }
});

test('below L70 round pay, clear bonus and entry fee scale with A(L)', () => {
    assert.deepEqual(petGauntletRyoSchedule(10), { perRound: 50, clearBonus: 300, entryFee: 300 });
    assert.deepEqual(petGauntletRyoSchedule(30), { perRound: 117, clearBonus: 700, entryFee: 700 });
    assert.deepEqual(petGauntletRyoSchedule(50), { perRound: 183, clearBonus: 1_100, entryFee: 1_100 });
    // A full clear at L10: 10 x 50 + 300.
    const l10 = petGauntletRyoSchedule(10);
    assert.equal(10 * l10.perRound + l10.clearBonus, 800);
});

test('a missing or bad level reads as level 1, never as the top schedule', () => {
    for (const level of [undefined, null, 'x', Number.NaN, -5, 0]) {
        assert.deepEqual(petGauntletRyoSchedule(level), { perRound: 20, clearBonus: 120, entryFee: 120 }, String(level));
    }
    assert.deepEqual(petGauntletRyoSchedule('40'), petGauntletRyoSchedule(40), 'a numeric string is a level');
});
