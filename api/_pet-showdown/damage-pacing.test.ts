import assert from 'node:assert/strict';
import test from 'node:test';
import { paceShowdownTechniqueDamage } from './damage-pacing.js';

test('low-level burst leaves a response while ordinary hits retain their damage', () => {
    for (const level of [1, 5, 10, 20, 25]) {
        assert.equal(paceShowdownTechniqueDamage(200, 400, level, level), 200);
        for (const damage of [241, 400, 800, 1600, 10000]) {
            const paced = paceShowdownTechniqueDamage(damage, 400, level, level);
            assert.ok(paced >= 240 && paced < 360);
        }
    }
});

test('burst pacing is continuous, monotonic, and does not protect wounded pets from a finisher', () => {
    let previous = 0;
    for (let damage = 1; damage < 2000; damage++) {
        const paced = paceShowdownTechniqueDamage(damage, 400, 1, 1);
        assert.ok(paced > previous);
        previous = paced;
    }
    assert.ok(Math.abs(paceShowdownTechniqueDamage(240.001, 400, 1, 1) - 240.001) < 0.0001);
    assert.ok(paceShowdownTechniqueDamage(450, 400, 1, 1) > 300, 'a wounded 300-HP target can be finished');
});

test('the curve fades smoothly with progression and preserves higher-level combat', () => {
    const novice = paceShowdownTechniqueDamage(800, 400, 25, 25);
    const middle = paceShowdownTechniqueDamage(800, 400, 37.5, 37.5);
    assert.equal(middle, (novice + 800) / 2);
    assert.equal(paceShowdownTechniqueDamage(800, 400, 50, 50), 800);
    assert.equal(paceShowdownTechniqueDamage(800, 400, 100, 1), 800);
    assert.equal(paceShowdownTechniqueDamage(800, 400, 1, 100), 800);
});

test('early-access ultimates keep moderate damage and soften extreme hits at every level', () => {
    for (const level of [1, 25, 50, 100]) {
        assert.equal(paceShowdownTechniqueDamage(280, 400, level, level, true), 280);
        let previous = 280;
        for (const damage of [281, 300, 400, 800, 1600, 100000]) {
            const paced = paceShowdownTechniqueDamage(damage, 400, level, level, true);
            assert.ok(paced > previous && paced < 360);
            previous = paced;
        }
        assert.ok(paceShowdownTechniqueDamage(800, 400, level, level, true) > 300, 'wounded targets can still be finished');
    }
});
