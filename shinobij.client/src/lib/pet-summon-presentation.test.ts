import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePetCardState, createPetCardState, petCardStatePose, PET_RECALL_SECONDS, PET_SUMMON_SECONDS, petRecallPose, petSummonPose } from './pet-summon-presentation';

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

test('recall holds the fallen pose, absorbs it, then leaves no visible body', () => {
    const state = createPetCardState(true, false);
    advancePetCardState(state, { present: false }, .5, .9);
    assert.equal(state.phase, 'holding');
    assert.equal(petCardStatePose(state).scale, 1);
    advancePetCardState(state, { present: false }, .5, .9);
    assert.equal(state.phase, 'recall');
    assert.equal(petRecallPose(.1).scale, 1);
    assert.ok(petRecallPose(.5).scale < 1);
    assert.equal(petRecallPose(.85).visible, false);
    advancePetCardState(state, { present: false }, PET_RECALL_SECONDS, .9);
    assert.equal(state.phase, 'hidden');
    assert.deepEqual(petCardStatePose(state), { visible: false, scale: 0, lift: 0 });
});

test('respawns and repeated summon/recall cycles reset the complete card cadence', () => {
    const state = createPetCardState();
    for (let cycle = 0; cycle < 5; cycle++) {
        advancePetCardState(state, { present: true }, PET_SUMMON_SECONDS);
        assert.equal(state.phase, 'settled');
        advancePetCardState(state, { present: false }, PET_RECALL_SECONDS);
        assert.equal(state.phase, 'hidden');
        advancePetCardState(state, { present: true }, 0);
        assert.equal(state.phase, 'summon');
        assert.equal(petCardStatePose(state).visible, false);
    }
});

test('leaving during a KO hold starts a complete recall instead of consuming its flight time', () => {
    const state = createPetCardState(true, false);
    advancePetCardState(state, { present: false }, .8, .9);
    assert.equal(state.phase, 'holding');
    advancePetCardState(state, { present: false }, .05, 0);
    assert.equal(state.phase, 'recall');
    assert.equal(state.elapsed, .05);
    assert.equal(petCardStatePose(state).scale, 1);
    advancePetCardState(state, { present: false }, PET_RECALL_SECONDS - .1, 0);
    assert.equal(state.phase, 'recall');
    advancePetCardState(state, { present: false }, .05, 0);
    assert.equal(state.phase, 'hidden');
});

test('host playback pause freezes recall and a rewind restores its opening summon', () => {
    const state = createPetCardState(true, false);
    advancePetCardState(state, { present: false, timeline: 10 }, 0);
    advancePetCardState(state, { present: false, timeline: 10.4 }, .05);
    const pose = petCardStatePose(state);
    for (let i = 0; i < 30; i++) advancePetCardState(state, { present: false, timeline: 10.4 }, .05);
    assert.deepEqual(petCardStatePose(state), pose);
    advancePetCardState(state, { present: true, timeline: 0 }, .05);
    assert.equal(state.phase, 'summon');
    assert.equal(state.elapsed, 0);
});

test('an interrupted summon never flashes a full-size body on recall', () => {
    const state = createPetCardState();
    advancePetCardState(state, { present: true }, PET_SUMMON_SECONDS * .55);
    const before = petCardStatePose(state);
    advancePetCardState(state, { present: false }, 0);
    assert.equal(petCardStatePose(state).scale, before.scale);
    assert.equal(petCardStatePose(state).lift, before.lift);
    const hidden = createPetCardState();
    advancePetCardState(hidden, { present: false }, 0);
    assert.equal(petCardStatePose(hidden).visible, false);
});

test('reduced motion preserves authoritative presence without scale or flight effects', () => {
    const state = createPetCardState();
    advancePetCardState(state, { present: true }, 0, .9, true);
    assert.deepEqual(petCardStatePose(state), { scale: 1, lift: 0, visible: true });
    advancePetCardState(state, { present: false }, 0, .9, true);
    assert.equal(state.phase, 'hidden');
    advancePetCardState(state, { present: true }, 0, .9, true);
    assert.equal(state.phase, 'settled');
});
