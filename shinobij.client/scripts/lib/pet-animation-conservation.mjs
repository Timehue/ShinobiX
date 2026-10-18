import assert from 'node:assert/strict';
import { reduceReviewedRotationExcursion } from './pet-animation-clearance.mjs';

export function assertReviewedAnimationConservation(before, after, clearance) {
    assert.equal(after.animations.length, before.animations.length);
    const allowed = new Set((clearance?.bones ?? []).map(b => `${b.replace(/[.]/g, '')}.quaternion`));
    let corrected = 0;
    for (let i = 0; i < before.animations.length; i++) {
        const a = before.animations[i], b = after.animations[i];
        assert.equal(b.name, a.name); assert.equal(b.tracks.length, a.tracks.length);
        for (let t = 0; t < a.tracks.length; t++) {
            const x = a.tracks[t], y = b.tracks[t];
            assert.equal(y.name, x.name); assert.deepEqual(y.times, x.times);
            if (a.name === clearance?.clip && allowed.has(x.name)) {
                assert.deepEqual(y.values, reduceReviewedRotationExcursion(x.values, clearance.rotationExcursion));
                corrected++;
            } else assert.deepEqual(y.values, x.values);
        }
    }
    assert.equal(corrected, allowed.size, 'Every approved rotation correction must be present exactly once');
    return corrected;
}
