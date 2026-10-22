import assert from 'node:assert/strict';
import test from 'node:test';
import { paceProgressionTechniqueDamage, paceShowdownTechniqueDamage } from './damage-pacing.js';

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

test('progression ordinary extremes leave a response without erasing reference hits or stat differences', () => {
    for (const level of [1, 10, 20, 75, 100]) {
        for (const damage of [48, 72, 100, 140, 180]) {
            assert.equal(paceProgressionTechniqueDamage(damage, 400, level, level), damage);
        }
        let previous = 180;
        for (let damage = 181; damage <= 10000; damage++) {
            const current = paceProgressionTechniqueDamage(damage, 400, level, level);
            assert.ok(current > previous && current < 260);
            previous = current;
        }
        assert.ok(Math.abs(paceProgressionTechniqueDamage(180.001, 400, level, level) - 180.001) < 0.0001);
        assert.ok(paceProgressionTechniqueDamage(400, 400, level, level) > 200, 'a wounded target can still be finished');
        assert.equal(paceProgressionTechniqueDamage(240, 400, level, level, true), 240, 'unprepared signature reference is unchanged');
        assert.equal(paceProgressionTechniqueDamage(300, 400, level, level, true, true), 300, 'prepared signature reference is unchanged');
    }
});
