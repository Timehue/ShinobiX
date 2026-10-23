import test from 'node:test';
import assert from 'node:assert/strict';
import { kunaiFlightMs, KUNAI_RETURN_MS, KUNAI_HAUL_MS } from '../../../shared/kunai-fishing';
import { kunaiRestPose, kunaiThrowPose, kunaiReturnPose, kunaiWindupMs, weaponTip, hauledFishPose, attachedKunaiPose, fishSpineMotion, type KunaiPose } from './kunai-fishing-motion';

const shot = { kind: 'throw' as const, at: 1000, x: 30, y: 40 };
const close = (a: KunaiPose, b: KunaiPose, tolerance = .01) => {
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < tolerance);
    assert.ok(Math.abs(Math.atan2(Math.sin(a.angle - b.angle), Math.cos(a.angle - b.angle))) < tolerance);
};
test('startling or catching a fish changes tail speed without snapping its pose or resetting phase', () => {
    const impact = shot.at + kunaiFlightMs(shot);
    const startle = fishSpineMotion(0, impact, [shot]), calm = fishSpineMotion(0, impact, []);
    assert.ok(Math.abs(startle.phase - calm.phase) < 1e-9 && startle.agitation < 1e-9);
    assert.deepEqual(fishSpineMotion(0, impact, [], impact), fishSpineMotion(0, impact, []));
    const before = fishSpineMotion(0, impact - .001, []), after = fishSpineMotion(0, impact + .001, [shot], impact);
    assert.ok(Math.abs(after.phase - before.phase) < .001);
    const settled = fishSpineMotion(0, impact + 8000, [shot]);
    assert.ok(settled.agitation < .001);
    assert.ok(settled.phase > fishSpineMotion(0, impact + 8000, []).phase, 'tail keeps its accumulated phase after recovering');
});
for (const [w, h] of [[710, 380], [304, 310], [268, 137]]) {
    test(`weapon stays continuous from hand to impact to retrieval at ${w}×${h}`, () => {
        for (const reduced of [false, true]) {
            const unit = Math.max(.55, Math.min(1, w / 700)), flight = kunaiFlightMs(shot), wind = kunaiWindupMs(shot);
            close(kunaiThrowPose(w, h, shot, 0, unit, reduced), kunaiRestPose(w, h, shot, unit));
            close(kunaiThrowPose(w, h, shot, wind - .001, unit, reduced), kunaiThrowPose(w, h, shot, wind + .001, unit, reduced));
            const impact = kunaiThrowPose(w, h, shot, flight, unit, reduced), tip = weaponTip(impact, unit);
            assert.ok(Math.hypot(tip.x - w * .3, tip.y - h * .4) < .001, 'blade tip must reach the exact aim point');
            close(impact, kunaiReturnPose(w, h, shot, 0, unit, reduced));
            close(kunaiReturnPose(w, h, shot, KUNAI_RETURN_MS, unit, reduced), kunaiRestPose(w, h, shot, unit));
            const initial = hauledFishPose(2718, 0, shot, 0, w, h);
            close(impact, attachedKunaiPose(w, h, shot, initial, initial, 0, unit, reduced));
            const landed = hauledFishPose(2718, 0, shot, KUNAI_HAUL_MS, w, h);
            assert.ok(Math.hypot(landed.x - w * .49, landed.y - h * .89) < .001);
            for (let age = 0; age <= flight + KUNAI_RETURN_MS; age += 16) {
                const pose = age <= flight ? kunaiThrowPose(w, h, shot, age, unit, reduced) : kunaiReturnPose(w, h, shot, age - flight, unit, reduced);
                assert.ok([pose.x, pose.y, pose.angle].every(Number.isFinite));
            }
        }
    });
}
