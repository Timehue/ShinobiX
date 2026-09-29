import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRallyQualitySample, rallyStartsLight, RALLY_ADAPTIVE_QUALITY_FPS, sampleRallyQuality } from './rally-quality';

test('light rendering needs sustained low frame rate, not one load spike or a pause', () => {
    const sample = newRallyQualitySample();
    for (let i = 0; i < 600; i++) assert.equal(sampleRallyQuality(sample, 1 / 60, true), false);
    assert.equal(sampleRallyQuality(sample, 1.5, true), false);
    for (let i = 0; i < 30; i++) assert.equal(sampleRallyQuality(sample, 1 / 25, true), false);
    sampleRallyQuality(sample, .1, false);
    assert.equal(sample.slowWindows, 0);
    let lowered = false;
    for (let i = 0; i < 120; i++) lowered ||= sampleRallyQuality(sample, 1 / 25, true);
    assert.equal(lowered, true);
});
test('known constrained hardware starts light; missing hardware hints do not force it', () => {
    assert.equal(rallyStartsLight(4, 8), true); assert.equal(rallyStartsLight(8, 2), true);
    assert.equal(rallyStartsLight(8, 8), false); assert.equal(rallyStartsLight(), false);
});
test('adaptive quality moves to lite before sustained performance falls below 48 FPS', () => {
    assert.equal(RALLY_ADAPTIVE_QUALITY_FPS, 48);
    const target = newRallyQualitySample();
    for (let i = 0; i < 480; i++) assert.equal(sampleRallyQuality(target, 1 / 48, true), false);
    const sample = newRallyQualitySample();
    let lowered = false;
    for (let i = 0; i < 360; i++) lowered ||= sampleRallyQuality(sample, 1 / 45, true);
    assert.equal(lowered, true);
});
