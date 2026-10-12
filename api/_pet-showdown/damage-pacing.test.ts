import assert from 'node:assert/strict';
import test from 'node:test';
import { paceShowdownTechniqueDamage } from './damage-pacing.js';

test('burst leaves a response at every level while ordinary hits retain their damage', () => {
    for (const level of [1, 5, 10, 20, 25, 50, 100]) {
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

test('progression cannot remove the response curve; stronger input still earns more damage', () => {
    for (const [attacker, defender] of [[1, 100], [100, 1], [50, 50]]) {
        assert.equal(paceShowdownTechniqueDamage(800, 400, attacker, defender), paceShowdownTechniqueDamage(800, 400, 1, 1));
        assert.ok(paceShowdownTechniqueDamage(800, 400, attacker, defender) > paceShowdownTechniqueDamage(400, 400, attacker, defender));
    }
});

test('early-access ultimates keep moderate damage and soften extreme hits at every level', () => {
    for (const level of [1, 25, 50, 100]) {
        for (const prepared of [false, true]) {
            const threshold = prepared ? 220 : 160;
            assert.equal(paceShowdownTechniqueDamage(threshold, 400, level, level, true, prepared), threshold);
            let previous = threshold;
            for (const damage of [221, 300, 400, 800, 1600, 100000]) {
                const paced = paceShowdownTechniqueDamage(damage, 400, level, level, true, prepared);
                assert.ok(paced > previous && paced < (prepared ? 300 : 240));
                previous = paced;
            }
        }
        assert.ok(paceShowdownTechniqueDamage(800, 400, level, level, true) > 200, 'wounded targets can still be finished');
        assert.ok(paceShowdownTechniqueDamage(800, 400, level, level, true, true) > paceShowdownTechniqueDamage(800, 400, level, level, true), 'setup rewards the invested turn');
    }
});
