import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hollowGateLossHp } from './hollow-gate-loss.js';

test('rift losses use 33% max HP with a living 1-HP floor, never current-HP scaling', () => {
    assert.equal(hollowGateLossHp(10000, 10000), 6700);
    assert.equal(hollowGateLossHp(8000, 10000), 4700);
    assert.equal(hollowGateLossHp(100, 10000), 1);
    assert.equal(hollowGateLossHp(3300, 10000), 1);
    assert.equal(hollowGateLossHp(1, 10000), 1);
    assert.equal(hollowGateLossHp(80, 100), 47);
    assert.equal(hollowGateLossHp(2, 3), 1);
});

test('a genuine zero-HP legacy state stays at zero', () => {
    assert.equal(hollowGateLossHp(0, 10000), 0);
    assert.equal(hollowGateLossHp(-3, 10000), 0);
});
