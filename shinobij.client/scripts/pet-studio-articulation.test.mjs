import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from 'three';
import { studioJointDeltas, sampleStudioRotation, delayedStudioRotation } from './lib/pet-studio-articulation.mjs';

test('distal joints coil before contact, then relax to neutral without altering neutral or death clips', () => {
    const names = new Set(['forearm.L', 'hand.L', 'shin.L', 'foot.L', 'front_lower.L', 'front_paw.L']);
    for (const clip of ['attack', 'cast', 'idle_hitreact1', 'victory', 'gallop_jump']) {
        for (const values of studioJointDeltas(names, clip, 0).values()) assert.ok(values.every(value => Math.abs(value) < 1e-8));
        for (const values of studioJointDeltas(names, clip, 1).values()) assert.ok(values.every(value => Math.abs(value) < 1e-8));
    }
    assert.ok(studioJointDeltas(names, 'attack', .3).get('forearm.L')[0] < -.1);
    for (const clip of ['idle', 'walk', 'gallop', 'rest', 'death']) assert.equal(studioJointDeltas(names, clip, .3).size, 0);
    assert.equal(studioJointDeltas(new Set(), 'attack', .3).size, 0);
});
test('all anatomy-specific accents stay bounded and authored flight keeps its wing control', () => {
    const names = new Set(['wing_mid.L', 'wing_mid.R', 'wing_tip.L', 'bat_wing_lower.L', 'claw_pincer.R', 'leg_front_lower.L', 'leg_mid_foot.R']);
    for (let p = 0; p <= 1; p += .01) for (const clip of ['attack', 'cast', 'guard', 'entrance', 'idle_hitreact1']) {
        for (const values of studioJointDeltas(names, clip, p).values()) assert.ok(values.every(value => Number.isFinite(value) && Math.abs(value) <= .14));
    }
    assert.equal(studioJointDeltas(names, 'gallop_jump', .3).has('wing_mid.L'), false);
});
test('normalized cubic rotations and delayed joints preserve endpoint bind poses', () => {
    const times = Float32Array.of(0, 1), a = new Quaternion(), b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, .3);
    const values = Float32Array.from([0, 0, 0, 0, ...a.toArray(), 0, 0, 0, 0, 0, 0, 0, 0, ...b.toArray(), 0, 0, 0, 0]);
    const sample = p => sampleStudioRotation(times, values, 'CUBICSPLINE', p);
    assert.ok(sample(0).angleTo(a) < 1e-5); assert.ok(sample(1).angleTo(b) < 1e-5);
    assert.ok(Math.abs(sample(.5).length() - 1) < 1e-6);
    const target = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, .2);
    for (const p of [0, 1]) assert.ok(delayedStudioRotation(a, target, sample, p, .06, .6).angleTo(target) < 1e-5);
    assert.ok(delayedStudioRotation(a, target, sample, .6, .06, .6).angleTo(target) > .02);
});
