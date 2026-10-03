import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareRallyClips, RALLY_CLIP_MAP, rallyAnimationDelta, rallyBodyPose, rallyClipSpeed, rallyJumpPhase, rallyWaitingMotion } from './rally-animation';
import { advanceRallyFinishPresentation, RALLY_FINISH_PRESENTATION_SECONDS } from './rally-presentation-clock';

test('running animation advances one second at 10–144 Hz without slowing down or dropping between-tick frames', () => {
    for (const hz of [10, 15, 20, 30, 60, 120, 144]) {
        let seconds = 0;
        for (let i = 0; i < hz; i++) seconds += rallyAnimationDelta(1 / hz, true, false, false);
        assert.ok(Math.abs(seconds - 1) < 1e-10);
    }
    assert.equal(rallyAnimationDelta(1 / 60, false, false, false), 0);
    assert.equal(rallyAnimationDelta(10, true, false, false), .1);
    assert.equal(rallyAnimationDelta(10, false, false, true), .05);
    assert.equal(rallyAnimationDelta(10, false, true, false), .05);
    assert.equal(rallyAnimationDelta(10, true, false, true), .05, 'the final simulation frame cannot overrun the finish clock');
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

function strideFixture(authoredKnee = false) {
    const rig = new THREE.Group();
    const root = new THREE.Bone(); root.name = 'root'; root.position.set(2, 3, 4);
    const upper = new THREE.Bone(); upper.name = 'front_upperL'; upper.rotation.x = .9;
    const lower = new THREE.Bone(); lower.name = 'front_lowerL'; lower.rotation.x = .1;
    const paw = new THREE.Bone(); paw.name = 'front_pawL'; paw.rotation.x = -.4;
    rig.add(root); root.add(upper); upper.add(lower); lower.add(paw);
    const times = [0, .25, .5, .75, 1];
    const values = [-.6, .1, .6, .1, -.6].flatMap(angle => upper.quaternion.clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle)).toArray());
    const gallop = new THREE.AnimationClip('gallop', 1, [
        new THREE.VectorKeyframeTrack('root.position', times, [2, 3, 4, 3, 3.1, 5, 4, 3.02, 6, 3, 3.12, 5, 2, 3, 4]),
        new THREE.QuaternionKeyframeTrack('front_upperL.quaternion', times, values),
    ]);
    if (authoredKnee) gallop.tracks.push(new THREE.QuaternionKeyframeTrack('front_lowerL.quaternion', [0, 1], [...lower.quaternion.toArray(), ...lower.quaternion.toArray()]));
    const clips = [...new Set(['idle', ...Object.values(RALLY_CLIP_MAP)])].map(name => name === 'gallop' ? gallop
        : new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack('root.position', [0, 1], [2, 3, 4, 5, 6, 7])]));
    return { rig, root, upper, lower, paw, clips, gallop };
}

test('gallop keeps authored vertical weight transfer while physics owns horizontal travel and jumps', () => {
    const { rig, root, clips, gallop } = strideFixture();
    const original = gallop.tracks.map(track => Array.from(track.values));
    const prepared = prepareRallyClips(clips, rig);
    const strideRoot = prepared.get('gallop')!.tracks.find(track => track.name === 'root.position')!;
    assert.deepEqual(Array.from(strideRoot.values), [2, 3, 4, 2, 3.1, 4, 2, 3.02, 4, 2, 3.12, 4, 2, 3, 4].map(Math.fround));
    assert.equal(prepared.get('gallop_jump')!.tracks.some(track => track.name === 'root.position'), false);
    assert.deepEqual(gallop.tracks.map(track => Array.from(track.values)), original, 'loader cache stays immutable');
    assert.deepEqual(root.position.toArray(), [2, 3, 4], 'bind pose stays immutable');
    assert.equal(prepareRallyClips(clips, rig, true).get('gallop')!.tracks.some(track => track.name === 'root.position'), false, 'reduced motion omits secondary body lift');
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(prepared.get('gallop')!).play();
    mixer.update(.25);
    assert.equal(root.position.x, 2);
    assert.equal(root.position.z, 4);
    assert.ok(root.position.y > 3, 'the planted body gains its authored stride lift');
});

test('generic upper swings and missing knee/paw tracks form a closed, bounded stride', () => {
    const { rig, upper, lower, paw, clips } = strideFixture();
    const upperBindInverse = upper.quaternion.clone().invert();
    const lowerBind = lower.quaternion.clone();
    const pawBind = paw.quaternion.clone();
    const prepared = prepareRallyClips(clips, rig).get('gallop')!;
    const upperTrack = prepared.tracks.find(track => track.name === 'front_upperL.quaternion')!;
    for (let offset = 0; offset < upperTrack.values.length; offset += 4) {
        const delta = upperBindInverse.clone().multiply(new THREE.Quaternion().fromArray(upperTrack.values, offset));
        assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(delta, 'XYZ').x) <= .480001, 'upper limbs keep a compact running silhouette');
    }
    for (const name of ['front_lowerL.quaternion', 'front_pawL.quaternion']) {
        const track = prepared.tracks.find(candidate => candidate.name === name)!;
        assert.ok(track);
        assert.deepEqual(Array.from(track.values.slice(0, 4)), Array.from(track.values.slice(-4)), 'loop seam remains closed');
        for (let offset = 0; offset < track.values.length; offset += 4) {
            assert.ok(Math.abs(new THREE.Quaternion().fromArray(track.values, offset).length() - 1) < 1e-6);
        }
    }
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(prepared).play();
    mixer.update(.5);
    assert.ok(lower.quaternion.angleTo(lowerBind) > .1);
    assert.ok(lower.quaternion.angleTo(lowerBind) < .4);
    assert.ok(paw.quaternion.angleTo(pawBind) > .05);
});

test('individual knee choreography and unfamiliar anatomy retain their authored tracks', () => {
    const detailed = strideFixture(true);
    const original = detailed.gallop.tracks.find(track => track.name === 'front_lowerL.quaternion')!;
    const prepared = prepareRallyClips(detailed.clips, detailed.rig).get('gallop')!;
    assert.equal(prepared.tracks.length, detailed.gallop.tracks.length);
    assert.deepEqual(Array.from(prepared.tracks.find(track => track.name === original.name)!.values), Array.from(original.values));
    assert.deepEqual(Array.from(prepared.tracks.find(track => track.name === 'front_upperL.quaternion')!.values), Array.from(detailed.gallop.tracks.find(track => track.name === 'front_upperL.quaternion')!.values));
    const unfamiliar = strideFixture();
    unfamiliar.lower.name = 'wing_lowerL';
    assert.equal(prepareRallyClips(unfamiliar.clips, unfamiliar.rig).get('gallop')!.tracks.length, unfamiliar.gallop.tracks.length);
    const showcase = strideFixture();
    const showcaseStride = prepareRallyClips(showcase.clips, showcase.rig, false, true).get('gallop')!;
    assert.equal(showcaseStride.tracks.length, showcase.gallop.tracks.length, 'showcase banks receive no extra limb tracks');
    assert.deepEqual(Array.from(showcaseStride.tracks.find(track => track.name === 'front_upperL.quaternion')!.values), Array.from(showcase.gallop.tracks.find(track => track.name === 'front_upperL.quaternion')!.values));
});

test('stride cadence follows slow acceleration and sprint speed without a stationary gallop', () => {
    assert.equal(rallyClipSpeed('start', 0), 0);
    assert.equal(rallyClipSpeed('run', 3), .2);
    assert.equal(rallyClipSpeed('run', 15), 1);
    assert.ok(rallyClipSpeed('sprint', 24) > rallyClipSpeed('run', 15));
    assert.equal(rallyClipSpeed('technique', 100), 1.9);
    assert.equal(rallyClipSpeed('victory', 0), 1);
});

test('jump tuck, descent extension and landing recovery follow physics with continuous phase boundaries', () => {
    assert.ok(rallyJumpPhase('jump', 10, 0)! < rallyJumpPhase('jump', 3, 0)!);
    assert.equal(rallyJumpPhase('jump', 3, 0), rallyJumpPhase('airborne', 3, 0));
    assert.ok(rallyJumpPhase('airborne', -5, 0)! > rallyJumpPhase('airborne', 0, 0)!);
    assert.equal(rallyJumpPhase('airborne', -10, 0), rallyJumpPhase('land', 0, 11));
    assert.equal(rallyJumpPhase('land', 0, 0), 1);
    assert.equal(rallyJumpPhase('run', 0, 0), null);
});

test('finish presentation waits for the whole authored victory at 5–60 rendered Hz while simulation runs at 60 Hz', () => {
    for (const renderHz of [5, 10, 20, 30, 60]) {
        const rig = new THREE.Group();
        const clip = new THREE.AnimationClip('victory', 2.3, []);
        const mixer = new THREE.AnimationMixer(rig);
        const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
        action.clampWhenFinished = true;
        let elapsed = 0, renderFrames = 0, simulatedFrames = 0;
        for (let tick = 1; elapsed < RALLY_FINISH_PRESENTATION_SECONDS; tick++) {
            simulatedFrames++;
            // Host callbacks between rendered frames advance simulation only.
            if (Math.floor(tick * renderHz / 60) === Math.floor((tick - 1) * renderHz / 60)) continue;
            const delta = 1 / renderHz;
            mixer.update(rallyAnimationDelta(delta, false, false, true));
            elapsed = advanceRallyFinishPresentation(elapsed, delta, true);
            renderFrames++;
            assert.ok(Math.abs(Math.min(mixer.time, 2.5) - elapsed) < 1e-9, 'result timer and mixer share displayed time');
        }
        assert.ok(renderFrames >= 50, 'no slow renderer can settle before fifty displayed frames');
        assert.equal(action.time, 2.3, 'the 2.3 second authored victory reaches its final pose');
        assert.ok(simulatedFrames >= renderFrames);
        if (renderHz < 20) assert.ok(simulatedFrames > 150, 'slow rendering extends presentation without changing simulation cadence');
    }
});

test('finish timing holds during renderer preparation and pause, and ignores invalid frame gaps', () => {
    let elapsed = 0;
    for (let frame = 0; frame < 200; frame++) elapsed = advanceRallyFinishPresentation(elapsed, 1 / 60, false);
    assert.equal(elapsed, 0, 'renderer warmup cannot complete the results');
    for (let frame = 0; frame < 20; frame++) elapsed = advanceRallyFinishPresentation(elapsed, .2, true);
    assert.ok(Math.abs(elapsed - 1) < 1e-9);
    for (let frame = 0; frame < 200; frame++) elapsed = advanceRallyFinishPresentation(elapsed, .2, false);
    assert.ok(Math.abs(elapsed - 1) < 1e-9, 'paused single demand renders do not advance presentation');
    for (const delta of [NaN, Infinity, -1]) assert.equal(advanceRallyFinishPresentation(elapsed, delta, true), elapsed);
});

test('a racer crossing during a jump plants in a waiting pose until its rivals finish', () => {
    for (const motion of ['run', 'sprint', 'jump', 'airborne', 'land'] as const) {
        const waiting = rallyWaitingMotion(motion, 2500, false);
        assert.equal(RALLY_CLIP_MAP[waiting], 'guard');
        assert.equal(rallyJumpPhase(waiting, -5, 7), null);
        assert.deepEqual(rallyBodyPose(waiting, 2, -5, 12, false), { bank: 0, pitch: 0, squash: 1 });
        assert.equal(rallyWaitingMotion(motion, null, false), motion, 'unfinished racers retain physics-driven poses');
    }
    assert.equal(rallyWaitingMotion('victory', 2500, true), 'victory');
    assert.equal(rallyWaitingMotion('defeat', 2500, true), 'defeat');
});
