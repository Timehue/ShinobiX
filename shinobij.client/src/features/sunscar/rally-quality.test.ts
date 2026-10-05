import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRallyQualitySample, rallyStartsLight, sampleRallyQuality } from './rally-quality';

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
test('three consecutive active stalls downgrade before a frozen simulation can advance', () => {
    const sample = newRallyQualitySample();
    assert.equal(sampleRallyQuality(sample, .8, true), false);
    assert.equal(sampleRallyQuality(sample, .9, true), false);
    assert.equal(sampleRallyQuality(sample, .7, true), true);
    assert.equal(sample.warmup, 0, 'a frozen render loop cannot depend on the usual warmup window');
    assert.equal(sampleRallyQuality(sample, .8, true), true);
    assert.equal(sample.stalledFrames, 3, 'the stall counter remains bounded until the renderer switches');
});
test('isolated stalls and normal frames cannot accumulate toward a stall downgrade', () => {
    const sample = newRallyQualitySample();
    for (let i = 0; i < 8; i++) {
        assert.equal(sampleRallyQuality(sample, 1, true), false);
        assert.equal(sampleRallyQuality(sample, 1 / 60, true), false);
        assert.equal(sample.stalledFrames, 0);
    }
});
test('pausing, invalid timing and an inactive race clear consecutive stalls', () => {
    for (const [delta, racing] of [[1, false], [.1, false], [NaN, true], [Infinity, true], [0, true], [-1, true]] as const) {
        const sample = newRallyQualitySample();
        sampleRallyQuality(sample, .8, true); sampleRallyQuality(sample, .8, true);
        assert.equal(sampleRallyQuality(sample, delta, racing), false);
        assert.equal(sample.stalledFrames, 0);
        assert.equal(sampleRallyQuality(sample, .8, true), false);
        assert.equal(sampleRallyQuality(sample, .8, true), false);
    }
});
