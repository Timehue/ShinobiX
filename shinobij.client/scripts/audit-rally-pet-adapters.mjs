import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { rawPetPool } from '../src/data/pet-pool.ts';
import { STARTER_PETS } from '../src/data/starter-pets.ts';
import { STARTER_EVOLUTIONS } from '../src/data/pet-evolutions.ts';
import { petCombatModel } from '../src/lib/pet-3d-models.ts';
import { warfrontPetModelConfig } from '../src/lib/pet-warfront-model-lod.ts';
import { prepareRallyClips, RALLY_CLIP_MAP } from '../src/features/sunscar/rally-animation.ts';
globalThis.self = globalThis;
await MeshoptDecoder.ready;
const root = resolve(import.meta.dirname, '..'), out = resolve(root, '../.tmp/sunscar-rig-audit');
await mkdir(out, { recursive: true });
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), rows = [];
// Node has no browser image decoder. This audit covers skeletons/geometry;
// real atlas loading and material appearance are checked by the browser QA.
loader.register(() => ({ name: 'RALLY_GEOMETRY_AUDIT', loadTexture: () => Promise.resolve(null) }));
const pets = [...rawPetPool, ...STARTER_PETS.map(p => p.pet), ...STARTER_EVOLUTIONS];
for (const pet of pets) {
    const model = warfrontPetModelConfig(petCombatModel(pet), true);
    assert.ok(model, pet.id);
    const source = resolve(root, 'public', model.url.split('?')[0].slice(1));
    const bytes = await readFile(source);
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const meshes = []; gltf.scene.traverse(node => { if (node instanceof THREE.SkinnedMesh) meshes.push(node); });
    assert.ok(meshes.length, `${pet.id}: no real skinning`);
    for (const mesh of meshes) {
        const weights = mesh.geometry.attributes.skinWeight, joints = mesh.geometry.attributes.skinIndex;
        assert.ok(weights && joints && mesh.skeleton.bones.length > 4, `${pet.id}: incomplete rig`);
        for (let vertex = 0; vertex < weights.count; vertex++) {
            const w = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)];
            const j = [joints.getX(vertex), joints.getY(vertex), joints.getZ(vertex), joints.getW(vertex)];
            assert.ok(w.every(n => Number.isFinite(n) && n >= 0) && Math.abs(w.reduce((s, n) => s + n, 0) - 1) < .015, `${pet.id}: invalid weights at ${vertex}`);
            assert.ok(j.every((n, i) => !w[i] || Number.isInteger(n) && n < mesh.skeleton.bones.length), `${pet.id}: unbound joint`);
        }
    }
    const originalTrackCounts = gltf.animations.map(c => c.tracks.length), bank = prepareRallyClips(gltf.animations);
    assert.deepEqual(gltf.animations.map(c => c.tracks.length), originalTrackCounts, 'Shared cached clips were mutated');
    const mixer = new THREE.AnimationMixer(gltf.scene), clips = [];
    for (const name of new Set(['idle', ...Object.values(RALLY_CLIP_MAP)])) {
        const clip = bank.get(name); assert.ok(clip, `${pet.id}/${name}`);
        let first = null, motion = 0;
        for (const fraction of [.15, .47, .83]) {
            mixer.stopAllAction();
            const action = mixer.clipAction(clip).reset().play(); action.time = clip.duration * fraction; mixer.update(0);
            gltf.scene.updateMatrixWorld(true);
            const points = [];
            for (const mesh of meshes) {
                mesh.skeleton.update();
                const pos = mesh.geometry.attributes.position, stride = Math.max(1, Math.ceil(pos.count / 300));
                for (let i = 0; i < pos.count; i += stride) {
                    const point = new THREE.Vector3().fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld);
                    assert.ok(point.toArray().every(Number.isFinite), `${pet.id}/${name}: invalid deformed vertex`); points.push(point);
                }
            }
            const extent = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length();
            assert.ok(extent > .01 && extent < 100, `${pet.id}/${name}: collapsed/exploded pose`);
            if (first) motion = Math.max(motion, ...points.map((p, i) => p.distanceTo(first[i]) / extent)); else first = points;
        }
        if (['gallop', 'gallop_jump', 'victory', 'idle_hitreact1'].includes(name)) assert.ok(motion > .005, `${pet.id}/${name}: static skinning`);
        clips.push({ name, motion: +motion.toFixed(5) });
    }
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    rows.push({ id: pet.id, visualId: model.visualId, profile: model.profile, source: model.url, clips });
}
const summary = { models: rows.length, poses: rows.reduce((sum, row) => sum + row.clips.length * 3, 0), profiles: [...new Set(rows.map(row => row.profile))] };
await writeFile(resolve(out, 'report.json'), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
