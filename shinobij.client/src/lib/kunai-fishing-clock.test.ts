import assert from 'node:assert/strict';
import test from 'node:test';
import { createKunaiElapsedClock } from './kunai-fishing-clock';
import { scoreKunaiFishing } from '../../../shared/kunai-fishing';

test('a clock correction after a throw preserves valid input and continuous retrieval', () => {
    let wall = 101_000, steady = 0;
    const clock = createKunaiElapsedClock(100_000, () => wall, () => steady);
    const shot = { kind: 'throw' as const, at: clock(), x: 6, y: 12 };
    wall -= 4000; steady += 40;
    assert.equal(clock(), 1040);
    assert.equal(scoreKunaiFishing(2718, [shot], clock(), true)?.phase, 'flight');
    wall += 1500; steady += 1500;
    assert.equal(clock(), 2540);
    assert.equal(scoreKunaiFishing(2718, [shot], clock(), true)?.phase, 'aiming');
});

test('reload uses the original admission time and a forward correction catches up to expiry', () => {
    let wall = 106_000, steady = 100;
    const clock = createKunaiElapsedClock(100_000, () => wall, () => steady);
    assert.equal(clock(), 6000);
    wall = 119_000; steady += 40;
    assert.equal(clock(), 19000);
    assert.equal(scoreKunaiFishing(2718, [], clock(), true)?.phase, 'escaped');
    wall -= 5000; steady += 40;
    assert.equal(clock(), 19040);
});
