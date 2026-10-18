import {repairOniAnatomicalLimbs} from './lib/pet-oni-anatomical-limbs.mjs';
import {repairOniCoordinatedActions} from './lib/pet-oni-anatomical-actions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPetDeformationProbe, preparePetHeadProbe, snapshotPetPose, petClipSampleTimes } from './lib/pet-deformation-probe.mjs';
import { oniSkullShare, ONI_SKULL_REPAIR_REVISION, repairOniSkull } from './repair-oni-hound-skull.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';
import { repairOniCoordinatedAttack } from './lib/pet-oni-coordinated-attack.mjs';

// Preserve the face-only repair's original conservation contract even after
// the separately reviewed action authoring intentionally changes leg tracks.
const faceOnlyFixture = new URL('./fixtures/pet-oni-coordinated-attack/mythic-4.glb', import.meta.url);

// These anatomical landmarks are independent of the repair's falloff. The v1
// test selected only vertices already made rigid by that repair and missed the
// nose, lips, teeth and lower jaw below y=.16.
const faceLandmarks = {
    muzzle: point => point.y >= .04 && point.y <= .15 && point.z >= .78,
    jaw: point => point.y >= -.16 && point.y <= .025 && point.z >= .75,
};

for (const version of ['roster', 'warfront-lod/roster']) test(`Oni Hound ${version}: skull stays coherent through every clip and blended transition`, async () => {
    const model = await loadPetDeformationProbe(new URL(`../public/pet-models/${version}/mythic-4.glb`, import.meta.url));
    assert.equal(model.json.extras.skullBindingRepair?.revision, ONI_SKULL_REPAIR_REVISION);
    assert.equal(model.animations.length, 13);
    if (version === 'roster') {
        const json = model.json, boundary = json.extras.properAnimationSourceBoundary;
        const weightAccessor = json.meshes[0].primitives[0].attributes.WEIGHTS_0;
        const view = json.bufferViews[json.accessors[weightAccessor].bufferView];
        const payload = view.extensions?.EXT_meshopt_compression ?? view;
        assert.ok(boundary.accessorCount > weightAccessor && boundary.bufferViewCount > json.accessors[weightAccessor].bufferView);
        assert.ok(boundary.binLength >= payload.byteOffset + payload.byteLength, 're-authoring would truncate the repaired skull binding');
    }
    const probe = preparePetHeadProbe(model.meshes[0], point => oniSkullShare(point) === 1);
    const landmarks = Object.entries(faceLandmarks).map(([name,mask]) => [name, preparePetHeadProbe(model.meshes[0], mask)]);
    assert.ok(probe.vertices > 1000, 'reviewed skull mask lost its face coverage');
    assert.ok(probe.edges > 1000, 'facial topology probe is incomplete');
    for (const [name,landmark] of landmarks) {
        assert.ok(landmark.vertices > 100, `${name}: anatomical landmark coverage lost`);
        assert.ok(landmark.edges > 100, `${name}: anatomical topology coverage lost`);
    }
    const restore = snapshotPetPose(model.scene), mixer = new THREE.AnimationMixer(model.scene);
    const verify = label => {
        model.update(); const measured = probe.measure();
        assert.ok(measured.maxDrift < .00002, `${label}: skull vertices slipped relative to head (${measured.maxDrift})`);
        assert.ok(measured.minRatio > .999 && measured.maxRatio < 1.001, `${label}: compressed or stretched facial edge`);
        for (const [name,landmark] of landmarks) {
            const face = landmark.measure();
            assert.ok(face.maxDrift < .00002, `${label}/${name}: face slipped relative to skull (${face.maxDrift})`);
            assert.ok(face.minRatio > .999 && face.maxRatio < 1.001, `${label}/${name}: face compressed or stretched`);
            assert.ok(face.worldMinRatio > .985 && face.worldMaxRatio < 1.015, `${label}/${name}: world-space face distortion`);
        }
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

test('released v1 Oni fixture exposes the lower-face defect while its old upper-skull check passes', async () => {
    const model = await loadPetDeformationProbe(new URL('./fixtures/oni-face-20261015/mythic-4-v1.glb', import.meta.url));
    assert.equal(model.sha256,'6a030f2152ff5de290d157d5bb41e392634a3899ea9c1f8b91bae979bcd92f64');
    assert.equal(model.json.extras.skullBindingRepair.revision, '20261014-oni-skull-v1');
    const mesh = model.meshes[0];
    const upper = preparePetHeadProbe(mesh, point => point.y >= .16 && point.z >= .30);
    const landmarks = Object.values(faceLandmarks).map(mask => preparePetHeadProbe(mesh,mask));
    const restore = snapshotPetPose(model.scene), peaks = landmarks.map(() => 0);
    const mixer = new THREE.AnimationMixer(model.scene);
    const idle = model.animations.find(clip => clip.name === 'idle');
    for (const time of petClipSampleTimes(idle,24)) {
        mixer.stopAllAction(); restore();
        const action = mixer.clipAction(idle).reset().setLoop(THREE.LoopOnce,1);
        action.clampWhenFinished = true; action.play(); action.time = time;
        mixer.update(0); model.update();
        assert.ok(upper.measure().maxDrift < .00002, 'fixture must retain the false assurance of the former check');
        landmarks.forEach((landmark,i) => { peaks[i] = Math.max(peaks[i],landmark.measure().maxDrift); });
    }
    for (const peak of peaks) assert.ok(peak > .02, 'independent muzzle/jaw check must catch the actual released defect');
});

test('complete-face repair conserves the sculpt, textures, skeleton, animation curves and grounded paws', async () => {
    const oldPath=new URL('./fixtures/oni-face-20261015/mythic-4-v1.glb',import.meta.url);
    const newPath=faceOnlyFixture;
    const before=await loadPetDeformationProbe(oldPath),after=await loadPetDeformationProbe(newPath);
    assert.deepEqual(before.json.nodes,after.json.nodes);
    const a=before.meshes[0].geometry,b=after.meshes[0].geometry;
    for(const name of ['position','normal','uv'])assert.deepEqual(a.attributes[name].array,b.attributes[name].array);
    assert.deepEqual(a.index.array,b.index.array);
    assert.equal(before.animations.length,after.animations.length);
    for(let i=0;i<before.animations.length;i++){
        const x=before.animations[i],y=after.animations[i];assert.equal(x.name,y.name);assert.equal(x.tracks.length,y.tracks.length);
        for(let j=0;j<x.tracks.length;j++){assert.equal(x.tracks[j].name,y.tracks[j].name);assert.deepEqual(x.tracks[j].times,y.tracks[j].times);assert.deepEqual(x.tracks[j].values,y.tracks[j].values);}
    }
    const images=bytes=>{const {json,bin}=parseStudioGlb(bytes);return json.images.map(image=>{const view=json.bufferViews[image.bufferView];return bin.subarray(view.byteOffset,view.byteOffset+view.byteLength);});};
    assert.deepEqual(images(await readFile(oldPath)),images(await readFile(newPath)));
    const palette=(g,v)=>{const p=Array(before.meshes[0].skeleton.bones.length).fill(0);for(let slot=0;slot<4;slot++)p[g.attributes.skinIndex.getComponent(v,slot)]+=g.attributes.skinWeight.getComponent(v,slot);return p;};
    let paws=0;for(let v=0;v<a.attributes.position.count;v++)if(a.attributes.position.getY(v)<-.65){assert.deepEqual(palette(a,v),palette(b,v));paws++;}
    assert.ok(paws>2000,'grounded paw coverage lost');
});

test('complete-face repair replays exactly from its pinned pre-repair fixture', async () => {
    const original=new URL('./fixtures/oni-face-20261015/mythic-4-original.glb',import.meta.url);
    const directory=await mkdtemp(join(tmpdir(),'oni-full-face-'));
    try {
        const replay=join(directory,'mythic-4.glb');
        await repairOniSkull(fileURLToPath(original),replay);
        const faceBytes=await readFile(replay);
        assert.deepEqual(faceBytes,await readFile(faceOnlyFixture));
        const final=await repairOniCoordinatedAttack(faceBytes);
        assert.deepEqual(final.bytes,await readFile(new URL('./fixtures/pet-oni-anatomical-limbs/mythic-4.glb',import.meta.url)));
        const gaits=await repairOniAnatomicalLimbs(final.bytes),anatomical=await repairOniCoordinatedActions(gaits.bytes);
        assert.deepEqual(anatomical.bytes,await readFile(new URL('../public/pet-models/roster/mythic-4.glb',import.meta.url)));
    } finally {
        assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
        assert.ok(basename(directory).startsWith('oni-full-face-'));
        await rm(directory,{recursive:true,force:true});
    }
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
