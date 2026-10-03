import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRallyRigPose } from './rally-rig-pose';

function fixture() {
    const scene = new THREE.Group(), root = new THREE.Bone(); root.name = 'root'; root.position.y = 1; scene.add(root);
    const bones: THREE.Bone[] = [root], positions: number[] = [], skinIndices: number[] = [], skinWeights: number[] = [];
    for (const [side, x] of [['L', -.5], ['R', .5]] as const) {
        const shin = new THREE.Bone(), foot = new THREE.Bone(); shin.name = `shin${side}`; shin.position.set(x, -.5, 0); foot.name = `foot${side}`; foot.position.y = -.5;
        root.add(shin); shin.add(foot); bones.push(shin, foot);
        for (const dx of [-.12, .12]) for (const y of [-.03, .06]) for (const z of [-.2, .2]) {
            positions.push(x + dx, y, z); skinIndices.push(bones.length - 1, 0, 0, 0); skinWeights.push(1, 0, 0, 0);
        }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
    const times = [0, .25, .5, .75, 1];
    const bank = new Map(['guard', 'gallop', 'gallop_jump'].map(name => [name, new THREE.AnimationClip(name, 1, [
        new THREE.VectorKeyframeTrack('root.position', times, times.flatMap((_, index) => [0, 1 + (name === 'gallop' ? [0, .35, .05, .3, 0][index] : .02), 0])),
    ])]));
    const low = () => { const point = new THREE.Vector3(); let result = Infinity;
        for (let index = 0; index < geometry.attributes.position.count; index++) { mesh.getVertexPosition(index, point); point.applyMatrix4(mesh.matrixWorld); result = Math.min(result, point.y); }
        return result;
    };
    return { scene, mesh, bones, bank, low };
}

test('animated, tilted skinned soles stay on the physical road or jump height without changing the rig or clips during preparation', () => {
    const value = fixture(), originals = value.bones.map(bone => ({ position: bone.position.toArray(), quaternion: bone.quaternion.toArray() }));
    const tracks = [...value.bank.values()].map(clip => Array.from(clip.tracks[0].values));
    const pose = createRallyRigPose(value.scene, value.bank);
    assert.deepEqual(value.bones.map(bone => ({ position: bone.position.toArray(), quaternion: bone.quaternion.toArray() })), originals);
    assert.deepEqual([...value.bank.values()].map(clip => Array.from(clip.tracks[0].values)), tracks);
    assert.equal(pose.method, 'sole'); assert.ok(pose.probeCount > 0 && pose.probeCount <= 96);
    const actor = new THREE.Group(), body = new THREE.Group(), stride = new THREE.Group(); actor.add(body); body.add(stride); stride.add(value.scene); stride.scale.setScalar(1.75);
    const mixer = new THREE.AnimationMixer(value.scene), action = mixer.clipAction(value.bank.get('gallop')!).play();
    for (let frame = 0; frame < 80; frame++) {
        pose.restoreStride(); action.time = frame / 80; action.paused = true; mixer.update(0);
        const jump = frame % 2 ? 1.8 : 0; actor.position.set(3, 7 + jump, -12); body.rotation.set(.12, 0, frame % 3 ? .16 : -.16); stride.rotation.z = pose.applyStride(action.time);
        pose.ground(body, actor); actor.updateMatrixWorld(true);
        assert.ok(Math.abs(value.low() - 7 - jump) < 1e-6, `actual contact drifted at frame ${frame}`);
        assert.deepEqual(actor.position.toArray(), [3, 7 + jump, -12], 'presentation never replaces simulation position or jump');
    }
});

test('rear recovery alternates legs, does not accumulate, and restores an unkeyed joint before a waiting or jump pose', () => {
    const value = fixture(), pose = createRallyRigPose(value.scene, value.bank);
    const left = value.bones[1], right = value.bones[3], foot = value.bones[2], bind = left.quaternion.clone(), footBind = foot.quaternion.clone();
    for (let frame = 0; frame < 60; frame++) {
        pose.applyStride(.25);
        assert.ok(Math.abs(left.quaternion.angleTo(bind) - .65) < 1e-9);
        assert.ok(Math.abs(foot.quaternion.angleTo(footBind) - .4) < 1e-9);
        assert.ok(right.quaternion.angleTo(bind) < 1e-9);
    }
    pose.restoreStride(); assert.ok(left.quaternion.angleTo(bind) < 1e-9); assert.ok(foot.quaternion.angleTo(footBind) < 1e-9);
    pose.applyStride(.75); assert.ok(left.quaternion.angleTo(bind) < 1e-9); assert.ok(Math.abs(right.quaternion.angleTo(bind) - .65) < 1e-9);
    pose.restoreStride(); pose.restoreStride(); assert.ok(right.quaternion.angleTo(bind) < 1e-9);
});

test('specialist rigs retain authored joint choreography while still gaining physical floor contact', () => {
    const value = fixture(); value.bones[1].rotation.x = .3; const authored = value.bones[1].quaternion.clone();
    const pose = createRallyRigPose(value.scene, value.bank, true);
    assert.equal(pose.applyStride(.25), 0); assert.deepEqual(value.bones[1].quaternion.toArray(), authored.toArray());
    const actor = new THREE.Group(), body = new THREE.Group(); actor.add(body); body.add(value.scene); actor.position.y = 2;
    pose.ground(body, actor); actor.updateMatrixWorld(true); assert.ok(Math.abs(value.low() - 2) < 1e-6);
});

test('unsupported or malformed support keeps the static presentation fallback and never emits an invalid offset', () => {
    const value = fixture(), pose = createRallyRigPose(value.scene, value.bank);
    const actor = new THREE.Group(), body = new THREE.Group(); actor.add(body); body.add(value.scene); value.scene.position.y = 100;
    assert.equal(pose.ground(body, actor), 0); assert.equal(body.position.y, 0);
    const empty = createRallyRigPose(new THREE.Group(), new Map());
    assert.equal(empty.probeCount, 0); assert.equal(empty.ground(body, actor), 0);
});
