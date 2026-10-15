import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadPetDeformationProbe, preparePetHeadProbe, snapshotPetPose, petClipSampleTimes } from './lib/pet-deformation-probe.mjs';
import { oniSkullShare, ONI_SKULL_REPAIR_REVISION } from './repair-oni-hound-skull.mjs';

for (const version of ['roster', 'warfront-lod/roster']) test(`Oni Hound ${version}: skull stays coherent through every clip and blended transition`, async () => {
    const model = await loadPetDeformationProbe(new URL(`../public/pet-models/${version}/mythic-4.glb`, import.meta.url));
    assert.equal(model.json.extras.skullBindingRepair?.revision, ONI_SKULL_REPAIR_REVISION);
    assert.equal(model.animations.length, 13);
    if (version === 'roster') {
        const json = model.json, boundary = json.extras.properAnimationSourceBoundary;
        const weightAccessor = json.meshes[0].primitives[0].attributes.WEIGHTS_0;
        const view = json.bufferViews[json.accessors[weightAccessor].bufferView];
        const payload = view.extensions.EXT_meshopt_compression;
        assert.ok(boundary.accessorCount > weightAccessor && boundary.bufferViewCount > json.accessors[weightAccessor].bufferView);
        assert.ok(boundary.binLength >= payload.byteOffset + payload.byteLength, 're-authoring would truncate the repaired skull binding');
    }
    const probe = preparePetHeadProbe(model.meshes[0], point => oniSkullShare(point) === 1);
    assert.ok(probe.vertices > 1000, 'reviewed skull mask lost its face coverage');
    assert.ok(probe.edges > 1000, 'facial topology probe is incomplete');
    const restore = snapshotPetPose(model.scene), mixer = new THREE.AnimationMixer(model.scene);
    const verify = label => {
        model.update(); const measured = probe.measure();
        assert.ok(measured.maxDrift < .00002, `${label}: skull vertices slipped relative to head (${measured.maxDrift})`);
        assert.ok(measured.minRatio > .999 && measured.maxRatio < 1.001, `${label}: compressed or stretched facial edge`);
    };
    for (const clip of model.animations) for (const time of petClipSampleTimes(clip, 24)) {
        mixer.stopAllAction(); restore();
        const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
        action.clampWhenFinished = true; action.play(); action.time = time; mixer.update(0);
        verify(`${clip.name}@${time}`);
    }
    // Mixing two valid poses can still break linear skinning at split boundaries.
    for (const from of model.animations) for (const to of model.animations) if (from !== to) for (const blend of [.25,.5,.75]) {
        mixer.stopAllAction(); restore();
        for (const [clip,weight,progress] of [[from,1-blend,.75],[to,blend,.25]]) {
            const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
            action.clampWhenFinished=true; action.setEffectiveWeight(weight).play(); action.time=clip.duration*progress;
        }
        mixer.update(0); verify(`${from.name}->${to.name}@${blend}`);
    }
    mixer.stopAllAction();
});

test('shape probe catches a smoothly squashed skull that a tear threshold misses', async () => {
    const model = await loadPetDeformationProbe(new URL('../public/pet-models/roster/mythic-4.glb', import.meta.url));
    const mesh = model.meshes[0], probe = preparePetHeadProbe(mesh, point => oniSkullShare(point) === 1);
    // Deliberately compress the surface after the baseline. This needs no 8x
    // stretch, NaN, missing animation, or open UV seam to be visibly wrong.
    const positions = mesh.geometry.attributes.position;
    for (let v=0;v<positions.count;v++) positions.setX(v, positions.getX(v)*.4);
    model.update(); const measured = probe.measure();
    assert.ok(measured.minRatio < .65 && measured.changedEdges > 0);
    assert.ok(measured.maxDrift > .04);
});
