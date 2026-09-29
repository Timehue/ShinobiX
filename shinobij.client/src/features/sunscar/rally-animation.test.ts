import test from 'node:test';
import assert from 'node:assert/strict';
import { rallyAnimationDelta, rallyBodyPose } from './rally-animation';

test('running animation advances one second at 60, 120 and 144 Hz without dropping between-tick frames', () => {
    for (const hz of [60, 120, 144]) {
        let seconds = 0;
        for (let i = 0; i < hz; i++) seconds += rallyAnimationDelta(1 / hz, true, false, false);
        assert.ok(Math.abs(seconds - 1) < 1e-10);
    }
    assert.equal(rallyAnimationDelta(1 / 60, false, false, false), 0);
    assert.equal(rallyAnimationDelta(10, true, false, false), .05);
});

test('rally banking, landing and recoil are bounded and disabled for reduced motion', () => {
    const right = rallyBodyPose('run', 2, 0, 0, false);
    const left = rallyBodyPose('run', -2, 0, 0, false);
    assert.equal(right.bank, -left.bank);
    assert.ok(Math.abs(right.bank) <= .16);
    assert.ok(rallyBodyPose('land', 0, -5, 0, false).squash < 1);
    assert.ok(rallyBodyPose('run', 0, 0, 27, false).pitch < 0);
    assert.deepEqual(rallyBodyPose('land', 2, -8, 27, true), { bank: 0, pitch: 0, squash: 1 });
});
