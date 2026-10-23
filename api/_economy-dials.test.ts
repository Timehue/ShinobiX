import { test } from 'node:test';
import assert from 'node:assert/strict';
import { economyDial, economySwitch } from './_economy-dials.js';
import { anchorRyoPerMinute, ECONOMY_ANCHOR_CAP } from '../shared/economy-anchor.js';
import { trainingRateTable } from './_training-config.js';
import { DAILY_COMBAT_STAT_CAP, DAILY_STAT_POINT_CAP, DAILY_STAT_POINT_CAP_MAX, STAT_GAIN_DIAL_STEPS, dailyStatPointCap, statGainMultiplier } from './_stat-growth.js';
// The client mirrors (constants/game.ts display defaults, lib/progression-dials
// frame normalizer) are pinned against these dials in
// shinobij.client/src/lib/progression-dials.test.ts: server-compiled tests
// cannot import client modules.

function withEnv(name: string, value: string | undefined, fn: () => void) {
    const prev = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    try { fn(); } finally {
        if (prev === undefined) delete process.env[name]; else process.env[name] = prev;
    }
}

test('economyDial returns the default when unset, blank or invalid', () => {
    const name = 'ECON_DIAL_TEST_VALUE';
    withEnv(name, undefined, () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0.5));
    withEnv(name, '  ', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0.5));
    withEnv(name, 'abc', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0.5));
    withEnv(name, '2', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0.5));
    withEnv(name, '-1', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0.5));
});

test('economyDial accepts an in-range env value', () => {
    const name = 'ECON_DIAL_TEST_VALUE';
    withEnv(name, '0', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0));
    withEnv(name, '1', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 1));
    withEnv(name, '0.25', () => assert.equal(economyDial(name, 0.5, { min: 0, max: 1 }), 0.25));
});

test('economySwitch parses on/off words and falls back otherwise', () => {
    const name = 'ECON_SWITCH_TEST_VALUE';
    withEnv(name, undefined, () => assert.equal(economySwitch(name, true), true));
    withEnv(name, 'off', () => assert.equal(economySwitch(name, true), false));
    withEnv(name, 'TRUE', () => assert.equal(economySwitch(name, false), true));
    withEnv(name, 'maybe', () => assert.equal(economySwitch(name, false), false));
});

test('DAILY_STAT_POINT_CAP defaults to 60 and accepts only whole points in [0, 300]', () => {
    assert.equal(DAILY_STAT_POINT_CAP, 60);
    assert.equal(DAILY_STAT_POINT_CAP_MAX, 300);
    withEnv('DAILY_STAT_POINT_CAP', undefined, () => assert.equal(dailyStatPointCap(), 60));
    for (const [raw, cap] of [['45', 45], ['0', 0], [' 90 ', 90], ['300', 300], ['-1', 60], ['301', 60], ['59.5', 60], ['many', 60], ['', 60]] as const) {
        withEnv('DAILY_STAT_POINT_CAP', raw, () => assert.equal(dailyStatPointCap(), cap, `'${raw}'`));
    }
    // The reservations' cap is the dial read at boot (no env in this process).
    if (process.env.DAILY_STAT_POINT_CAP === undefined) assert.equal(DAILY_COMBAT_STAT_CAP, 60);
});

test('TRAINING_RATE_TABLE reads v2 unless it says legacy', () => {
    for (const [raw, table] of [[undefined, 'v2'], ['legacy', 'legacy'], [' LEGACY ', 'legacy'], ['v2', 'v2'], ['old', 'v2'], ['', 'v2']] as const) {
        withEnv('TRAINING_RATE_TABLE', raw, () => assert.equal(trainingRateTable(), table, `'${raw}'`));
    }
});

test('the era dial stays at 1 by default and its pacing steps include the default', () => {
    withEnv('STAT_GAIN_MULTIPLIER', undefined, () => assert.equal(statGainMultiplier(), 1));
    assert.deepEqual([...STAT_GAIN_DIAL_STEPS], [0.9, 0.95, 1, 1.03, 1.06]);
});

test('anchor curve is min(300, 20 + 4L) and plateaus at L70', () => {
    assert.equal(anchorRyoPerMinute(1), 24);
    assert.equal(anchorRyoPerMinute(10), 60);
    assert.equal(anchorRyoPerMinute(30), 140);
    assert.equal(anchorRyoPerMinute(50), 220);
    assert.equal(anchorRyoPerMinute(70), ECONOMY_ANCHOR_CAP);
    assert.equal(anchorRyoPerMinute(90), ECONOMY_ANCHOR_CAP);
    assert.equal(anchorRyoPerMinute(Number.NaN), 24);
    assert.equal(anchorRyoPerMinute(0), 24);
    assert.equal(anchorRyoPerMinute(500), ECONOMY_ANCHOR_CAP);
});
