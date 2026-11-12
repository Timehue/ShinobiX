import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGaitBrake } from './world-gait-brake';

test('a full-speed release uses the authored ground distance at phone and desktop frame rates', () => {
    for (const [gait, speed, distance] of [['walk',31,3.224],['run',120,8.034]] as const) {
        for (const hz of [12,24,60,120]) {
            const brake = createGaitBrake(speed, gait);
            let total = 0, previous = Infinity;
            while (!brake.done) {
                const step = brake.advance(1/hz);
                assert.ok(step >= 0 && step <= previous);
                total += step;
                previous = step;
            }
            assert.ok(Math.abs(total-distance) < 1e-8);
            assert.equal(brake.advance(1), 0);
        }
        assert.ok(Math.abs(createGaitBrake(speed/2, gait).advance(1) - distance/2) < 1e-8);
    }
});
