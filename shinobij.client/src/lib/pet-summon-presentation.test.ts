import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_SUMMON_SECONDS, petSummonPose } from './pet-summon-presentation';

test('pet appears only when the Beast Seal releases, then settles at its exact battle transform', () => {
    assert.equal(petSummonPose(0).visible, false);
    assert.equal(petSummonPose(PET_SUMMON_SECONDS * .48).visible, false);
    assert.equal(petSummonPose(PET_SUMMON_SECONDS * .5).visible, true);
    for (const time of [PET_SUMMON_SECONDS, PET_SUMMON_SECONDS * 10]) {
        const pose = petSummonPose(time);
        assert.equal(pose.scale, 1);
        assert.ok(Math.abs(pose.lift) < 1e-12);
        assert.equal(pose.visible, true);
    }
});
