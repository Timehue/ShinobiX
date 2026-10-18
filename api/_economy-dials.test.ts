import { test } from 'node:test';
import assert from 'node:assert/strict';
import { economyDial, economySwitch } from './_economy-dials.js';
import { anchorRyoPerMinute, ECONOMY_ANCHOR_CAP } from '../shared/economy-anchor.js';

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
