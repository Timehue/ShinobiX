import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioTangents } from './lib/pet-studio-curves.mjs';

const sample = (a, b, ta, tb, time, duration) => {
    const t = time, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * duration * ta + (-2 * t3 + 3 * t2) * b + (t3 - t2) * duration * tb;
};
test('studio curves keep contact keys exact and cannot overshoot scalar poses', () => {
    const times = [0, .12, .3, .4, .54, .7, .85, 1], values = [0, -.03, -.045, .1, .19, .1, .025, 0];
    const tangents = studioTangents(times, values, 1);
    for (let i = 0; i < times.length - 1; i++) for (let step = 0; step <= 100; step++) {
        const value = sample(values[i], values[i + 1], tangents[i], tangents[i + 1], step / 100, times[i + 1] - times[i]);
        assert.ok(value >= Math.min(values[i], values[i + 1]) - 1e-7 && value <= Math.max(values[i], values[i + 1]) + 1e-7);
    }
    assert.equal(tangents[0], 0); assert.equal(tangents.at(-1), 0);
});
test('a locomotion loop has matching velocity on both sides of its seam', () => {
    const tangent = studioTangents([0, .2, .4, .6, .8], [0, 1, 0, -1, 0], 1, true);
    assert.equal(tangent[0], tangent.at(-1)); assert.ok(tangent[0] > 0);
    assert.equal(tangent[1], 0); assert.equal(tangent[3], 0);
});
