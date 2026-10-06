import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { createPetCombatRigMotion } from './pet-combat-rig-motion';

async function rig(id: string, folder = 'roster') {
    const bytes=await readFile(new URL(`../../public/pet-models/${folder}/${id}.glb`,import.meta.url));
    const length=bytes.readUInt32LE(12), json=JSON.parse(bytes.subarray(20,20+length).toString()), binary=bytes.subarray(28+length);
    json.materials=[]; json.textures=[]; json.images=[];
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
    const text=Buffer.from(JSON.stringify(json)), size=(text.length+3)&~3, output=Buffer.alloc(28+size+binary.length);
    output.writeUInt32LE(0x46546c67,0); output.writeUInt32LE(2,4); output.writeUInt32LE(output.length,8);
    output.writeUInt32LE(size,12); output.writeUInt32LE(0x4e4f534a,16); output.fill(32,20,20+size); text.copy(output,20);
    output.writeUInt32LE(binary.length,20+size); output.writeUInt32LE(0x004e4942,24+size); binary.copy(output,28+size);
    const loader=new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); await MeshoptDecoder.ready;
    return loader.parseAsync(output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength),'');
}
const frame = {motion:'idle' as const,timeline:1,delta:1/60,phase:.75,galloping:false,locomotion:false,wingPhase:null as number|null,breath:1,lookYaw:0,contact:false};

test('actual Pine Owl unkeyed middle wings do not accumulate or leak after 10 dodge cycles', async () => {
    const gltf=await rig('standard-10'), mixer=new THREE.AnimationMixer(gltf.scene);
    const mid=gltf.scene.getObjectByName('wing_midL')!;
    assert.ok(mid instanceof THREE.Bone);
    assert.ok(gltf.animations.every(c => !c.tracks.some(t => t.name===`${mid.name}.quaternion`)), 'regression uses the real unkeyed joint');
    const base=mid.quaternion.clone(), layer=createPetCombatRigMotion([gltf.scene]);
    const action=mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations,'gallop_jump')!).play();
    for(let cycle=0;cycle<10;cycle++) for(let f=0;f<60;f++) {
        layer.restore(); mixer.update(f===30 ? 0 : 1/144);
        layer.apply({...frame,motion:'dodge',timeline:cycle+f/60,wingPhase:f/60},action.getClip());
        assert.ok(mid.quaternion.angleTo(base) < .62,'middle wing must remain within one bounded pose');
    }
    layer.restore(); assert.ok(mid.quaternion.equals(base), 'restore retains the exact imported quaternion, including float rounding');
    layer.apply({...frame,motion:'dead'},THREE.AnimationClip.findByName(gltf.animations,'death')!);
    assert.ok(mid.quaternion.equals(base),'KO cannot inherit a wing fold');
});

test('real fox and rabbit distal recovery supplements unkeyed joints and restores the authored pose', async () => {
    for(const id of ['standard-0','standard-1']) {
        const gltf=await rig(id), layer=createPetCombatRigMotion([gltf.scene]), mixer=new THREE.AnimationMixer(gltf.scene);
        const clip=THREE.AnimationClip.findByName(gltf.animations,'walk')!;
        const phase = id === 'standard-0' ? .75 : .25;
        const action=mixer.clipAction(clip).play(); action.time=clip.duration*phase; mixer.update(0);
        const lower=gltf.scene.getObjectByName(id==='standard-0'?'front_lowerL':'shinL')!;
        const pose=lower.quaternion.clone();
        layer.apply({...frame,phase,motion:'run',locomotion:true,delta:1},clip);
        assert.ok(lower.quaternion.angleTo(pose) > .2);
        layer.restore(); assert.ok(lower.quaternion.angleTo(pose)<1e-7);
        layer.apply({...frame,motion:'strike',contact:true,locomotion:true},clip);
        assert.ok(lower.quaternion.angleTo(pose)<1e-7,'contact takes retain full authored leg pose');
        const detailed=createPetCombatRigMotion([gltf.scene],true);
        detailed.apply({...frame,motion:'run',locomotion:true,delta:1},clip);
        assert.ok(lower.quaternion.angleTo(pose)<1e-7,'showcase leg motion is preserved');
    }
});

test('rigid meshes and unfamiliar arthropod limbs receive no generic leg deformation', () => {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
    const layer=createPetCombatRigMotion([mesh]); assert.equal(layer.jointCount,0);
    const before=mesh.matrix.clone(); layer.apply({...frame,motion:'run',locomotion:true},null);
    assert.deepEqual(mesh.matrix.elements,before.elements);
});

test('missing or misparented named limbs are excluded from secondary deformation', () => {
    const scene = new THREE.Group(), upper = new THREE.Bone(), lower = new THREE.Bone(), tip = new THREE.Bone();
    upper.name = 'thighL'; lower.name = 'shinL'; tip.name = 'footL';
    scene.add(upper, lower); lower.add(tip);
    const layer = createPetCombatRigMotion([scene]);
    assert.equal(layer.jointCount, 0, 'matching names without a real chain cannot authorize limb recovery');
    layer.apply({...frame, motion:'run', locomotion:true, delta:1}, null);
    assert.ok(lower.quaternion.equals(new THREE.Quaternion()));
});

test('secondary breathing/attention holds exactly through a frozen host clock', async () => {
    const gltf=await rig('standard-0'), mixer=new THREE.AnimationMixer(gltf.scene), layer=createPetCombatRigMotion([gltf.scene]);
    const clip=THREE.AnimationClip.findByName(gltf.animations,'idle')!;
    mixer.clipAction(clip).play(); mixer.update(.2); layer.apply({...frame,delta:.2,lookYaw:.12},clip);
    const neck=gltf.scene.getObjectByName('neck')!, pose=neck.quaternion.clone();
    for(let f=0;f<100;f++) { layer.restore(); mixer.update(0); layer.apply({...frame,delta:0,lookYaw:.12},clip); assert.ok(neck.quaternion.equals(pose)); }
});

test('committed contact and defeat suppress residual avian wing phases', async () => {
    const gltf = await rig('standard-10'), layer = createPetCombatRigMotion([gltf.scene]);
    const wing = gltf.scene.getObjectByName('wing_midL')!, base = wing.quaternion.clone();
    for (const motion of ['dodge', 'dead'] as const) {
        layer.restore();
        layer.apply({...frame, motion, contact: motion === 'dodge', wingPhase: .4}, null);
        assert.ok(wing.quaternion.equals(base), 'committed authored poses win over residual wing drive');
    }
});

test('bipeds alternate gallop recovery while quadrupeds pair their forefeet', async () => {
    for(const id of ['standard-0','standard-1']) {
        const gltf=await rig(id), layer=createPetCombatRigMotion([gltf.scene]);
        const left=gltf.scene.getObjectByName(id==='standard-0'?'front_lowerL':'shinL')!, right=gltf.scene.getObjectByName(id==='standard-0'?'front_lowerR':'shinR')!;
        const leftBase=left.quaternion.clone(), rightBase=right.quaternion.clone();
        layer.apply({...frame,phase:id==='standard-0'?.75:.25,motion:'run',locomotion:true,galloping:true,delta:1},THREE.AnimationClip.findByName(gltf.animations,'gallop')!);
        assert.ok(left.quaternion.angleTo(leftBase) > .35);
        if(id==='standard-0') assert.ok(right.quaternion.angleTo(rightBase) > .35);
        else assert.ok(right.quaternion.equals(rightBase),'the opposite biped foot stays in stance');
    }
});

test('rabbit and owl recovery follows the forward swing of their actual authored foot trajectory', async () => {
    for (const id of ['standard-1', 'standard-10']) {
        const gltf = await rig(id), mixer = new THREE.AnimationMixer(gltf.scene), layer = createPetCombatRigMotion([gltf.scene]);
        const clip = THREE.AnimationClip.findByName(gltf.animations, 'walk')!, action = mixer.clipAction(clip).play();
        action.paused = true;
        const foot = gltf.scene.getObjectByName('footL')!, shin = gltf.scene.getObjectByName('shinL')!;
        const position = new THREE.Vector3();
        for (const phase of [.25, .75]) {
            layer.restore(); action.time = (phase - .05) * clip.duration; mixer.update(0); gltf.scene.updateMatrixWorld(true);
            const startZ = foot.getWorldPosition(position).z;
            action.time = (phase + .05) * clip.duration; mixer.update(0); gltf.scene.updateMatrixWorld(true);
            const forward = foot.getWorldPosition(position).z > startZ;
            assert.equal(forward, phase === .25, 'actual hip bank owns which half-cycle swings forward');
            action.time = phase * clip.duration; mixer.update(0);
            const authored = shin.quaternion.clone();
            layer.apply({...frame, phase, motion:'run', locomotion:true, delta:1}, clip);
            if (forward) assert.ok(shin.quaternion.angleTo(authored) > .2, 'recover the swinging shin');
            else assert.ok(shin.quaternion.equals(authored), 'leave the stance shin authored');
        }
    }
});

test('avian wing envelope starts and finishes at the authored pose without a state-change snap', async () => {
    const gltf = await rig('standard-10'), layer = createPetCombatRigMotion([gltf.scene]);
    const wing = gltf.scene.getObjectByName('wing_midL')!, authored = wing.quaternion.clone();
    for (const phase of [0, 1]) {
        layer.restore(); layer.apply({...frame, motion:'dodge', wingPhase:phase}, null);
        assert.ok(wing.quaternion.equals(authored), 'unkeyed wings land before the clip transition');
    }
});

test('all four actual showcase banks retain every authored take through fast sampling and frozen contact', async () => {
    for (const id of ['rare-1','standard-7','starter-fire-l','starter-lightning-l']) {
        const gltf = await rig(id, 'showdown-v2'), mixer = new THREE.AnimationMixer(gltf.scene);
        const layer = createPetCombatRigMotion([gltf.scene], true), bones: THREE.Bone[] = [];
        gltf.scene.traverse(node => { if (node instanceof THREE.Bone) bones.push(node); });
        assert.equal(gltf.animations.length, 13);
        for (const clip of gltf.animations) {
            layer.restore(); mixer.stopAllAction();
            const action = mixer.clipAction(clip).reset().play(); action.paused = true;
            for (const phase of [0,.74,.15,1]) {
                layer.restore(); action.time = clip.duration * phase; mixer.update(0);
                const authored = bones.map(bone => bone.quaternion.clone());
                for (let freeze = 0; freeze < 3; freeze++) {
                    layer.restore(); mixer.update(0);
                    layer.apply({...frame, motion:'strike', contact:true, locomotion:true, wingPhase:.4, delta:0},clip);
                    bones.forEach((bone,index) => assert.ok(bone.quaternion.equals(authored[index]), `${id} ${clip.name} keeps the exact authored contact pose`));
                }
            }
        }
    }
});
