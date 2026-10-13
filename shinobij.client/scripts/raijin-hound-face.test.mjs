import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

const REQUIRED_CLIPS = ['idle', 'idle_2', 'walk', 'gallop', 'gallop_jump', 'attack', 'idle_hitreact1', 'death', 'entrance', 'cast', 'guard', 'rest', 'victory'];

async function modelMetadata(path) {
    const bytes = await readFile(new URL(path, import.meta.url));
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
}

test('Raijin distant battle model carries the same complete action bank', async () => {
    const source = await modelMetadata('../public/pet-models/showdown-v2/starter-lightning-l.glb');
    const distant = await modelMetadata('../public/pet-models/warfront-lod/showdown-v2/starter-lightning-l.glb');
    assert.deepEqual(source.animations.map(clip => clip.name), REQUIRED_CLIPS);
    assert.deepEqual(distant.animations.map(clip => clip.name), REQUIRED_CLIPS);
    assert.equal(distant.extras?.showdownAnimationIdentity?.fingerprint, source.extras?.showdownAnimationIdentity?.fingerprint);
    assert.equal(distant.skins?.[0]?.joints?.length, 21);
});

async function loadHound(showdown) {
    const path = new URL(`../public/pet-models/${showdown ? 'showdown-v2/' : ''}starter-lightning-l.glb`, import.meta.url);
    const bytes = await readFile(path);
    const jsonLength = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    const binary = bytes.subarray(28 + jsonLength);
    // Remove texture references only in this in-memory copy. Geometry tests
    // then need neither browser image decoding nor a global self/DOM shim.
    json.materials = []; json.textures = []; json.images = [];
    json.meshes.forEach(mesh => mesh.primitives.forEach(primitive => { delete primitive.material; }));
    const text = Buffer.from(JSON.stringify(json));
    const padded = (text.length + 3) & ~3;
    const output = Buffer.alloc(28 + padded + binary.length);
    output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(padded, 12); output.writeUInt32LE(0x4e4f534a, 16);
    output.fill(0x20, 20, 20 + padded); text.copy(output, 20);
    output.writeUInt32LE(binary.length, 20 + padded); output.writeUInt32LE(0x004e4942, 24 + padded);
    binary.copy(output, 28 + padded);
    await MeshoptDecoder.ready;
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(output.buffer, '');
    const meshes = [];
    gltf.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
    const update = () => {
        gltf.scene.updateMatrixWorld(true);
        meshes.forEach(mesh => mesh.skeleton.update());
    };
    update();
    return { ...gltf, meshes, update, repair: json.extras?.skinSeamRepair, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function headShare(mesh, vertex) {
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
    let head = 0, total = 0;
    for (let slot = 0; slot < 4; slot++) {
        const weight = weights.getComponent(vertex, slot);
        total += weight;
        if (mesh.skeleton.bones[joints.getComponent(vertex, slot)]?.name === 'head') head += weight;
    }
    assert.ok(Math.abs(total - 1) < 0.015, 'face skin weights must sum to one');
    return head;
}

const featureNames = mesh => mesh.geometry.userData.raijinFaceFeatures
    ?? (mesh.geometry.userData.raijinFaceFeature ? [mesh.geometry.userData.raijinFaceFeature] : []);

test('Raijin source and showcase retain the reviewed sculpt and certified seamless skin', async () => {
    const source = await loadHound(false), showdown = await loadHound(true);
    assert.equal(source.meshes.length, 1, 'reviewed sculpt should be one continuous textured mesh');
    assert.equal(showdown.meshes.length, 1);
    for (let index = 0; index < source.meshes.length; index++) {
        const before = source.meshes[index], after = showdown.meshes[index];
        assert.deepEqual(featureNames(before), featureNames(after));
        for (const name of ['position', 'normal', 'uv']) {
            const a = before.geometry.attributes[name], b = after.geometry.attributes[name];
            assert.equal(a.count, b.count); assert.equal(a.itemSize, b.itemSize);
            for (let vertex = 0; vertex < a.count; vertex++) for (let slot = 0; slot < a.itemSize; slot++) assert.equal(b.getComponent(vertex, slot), a.getComponent(vertex, slot), `${name}/${vertex}/${slot} changed during showcase authoring`);
        }
        assert.equal(after.geometry.index.count, before.geometry.index.count);
        for (let corner = 0; corner < before.geometry.index.count; corner++) assert.equal(after.geometry.index.getX(corner), before.geometry.index.getX(corner), 'index compaction must preserve topology');
        const joints = after.geometry.attributes.skinIndex, weights = after.geometry.attributes.skinWeight;
        for (let vertex = 0; vertex < joints.count; vertex++) {
            let sum = 0;
            for (let slot = 0; slot < 4; slot++) {
                const joint = joints.getComponent(vertex, slot), weight = weights.getComponent(vertex, slot);
                assert.ok(Number.isInteger(joint) && joint >= 0 && joint < after.skeleton.bones.length);
                assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
                sum += weight;
            }
            assert.ok(Math.abs(sum - 1) < 1e-6);
        }
    }
    assert.match(showdown.repair.revision, /^20261012-connected-weight-v[12]$/);
    const certificates = JSON.parse(await readFile(new URL('../public/pet-models/warfront-lod/manifest.json', import.meta.url))).entries;
    assert.equal(showdown.sha256, certificates.find(entry => entry.sourceUrl === '/pet-models/showdown-v2/starter-lightning-l.glb').sourceSha256, 'the skin must match the reviewed runtime fingerprint');
    assert.ok(showdown.meshes[0].geometry.attributes.position.count > 45_000, 'facial sculpt lost too much production detail');
});

test('Raijin muzzle stays cohesive through every production animation', async () => {
    const model = await loadHound(true);
    assert.deepEqual(model.animations.map(clip => clip.name).sort(), [...REQUIRED_CLIPS].sort());
    const surface = model.meshes[0];
    const positions = surface.geometry.attributes.position;
    const bindPoints = Array.from({ length: positions.count }, (_,vertex) => surface.getVertexPosition(vertex, new THREE.Vector3()));
    // The new sculpt faces local +Z. Sample the muzzle, eyes and forehead.
    const inFace = point => point.z > 0.24 && point.y > 0;
    const faceVertices = bindPoints.flatMap((point, vertex) => inFace(point) ? [vertex] : []);
    assert.ok(faceVertices.length > 1000, 'the measured face region is missing');
    const skullWeighted = faceVertices.filter(vertex => headShare(surface, vertex) > 0.3);
    assert.ok(skullWeighted.length > 1000, 'muzzle and brow are not following the head bone');

    const edges = new Map(), indices = surface.geometry.index;
    assert.ok(indices, 'expected the indexed production surface');
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
        for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
            const a = indices.getX(triangle + from), b = indices.getX(triangle + to);
            if (!inFace(bindPoints[a]) || !inFace(bindPoints[b])) continue;
            const length = bindPoints[a].distanceTo(bindPoints[b]);
            // Exclude near-zero atlas seam edges; ordinary face edges expose
            // the old deformation without division amplifying quantization.
            if (length > 0.002) edges.set(a < b ? `${a},${b}` : `${b},${a}`, { a, b, length });
        }
    }
    assert.ok(edges.size > 3000, 'the facial topology sample is incomplete');
    const sampledVertices = [...new Set([...edges.values()].flatMap(edge => [edge.a, edge.b]))];
    const posed = new Map(sampledVertices.map(vertex => [vertex, new THREE.Vector3()]));
    const bind = surface.skeleton.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
    const mixer = new THREE.AnimationMixer(model.scene);
    let maximumStretch = 0;
    let maximumDisplacement = 0;
    for (const clip of model.animations) {
        mixer.stopAllAction();
        surface.skeleton.bones.forEach((bone, index) => {
            bone.position.copy(bind[index].position);
            bone.quaternion.copy(bind[index].quaternion);
            bone.scale.copy(bind[index].scale);
        });
        const action = mixer.clipAction(clip).reset().play();
        const times = [...new Set(clip.tracks.flatMap(track => [...track.times]))].sort((a, b) => a - b);
        const samples = [...times, ...times.slice(1).map((time, index) => (times[index] + time) / 2)];
        for (const time of samples) {
            action.time = time; mixer.update(0); model.update();
            for (const vertex of sampledVertices) {
                surface.getVertexPosition(vertex, posed.get(vertex));
                maximumDisplacement = Math.max(maximumDisplacement, posed.get(vertex).distanceTo(bindPoints[vertex]));
            }
            for (const edge of edges.values()) {
                const ratio = posed.get(edge.a).distanceTo(posed.get(edge.b)) / edge.length;
                maximumStretch = Math.max(maximumStretch, ratio);
                // The inherited nonuniform rig scale permits bounded affine
                // stretch (~1.53x in death). Split face weights reached 40x.
                assert.ok(ratio > 1 / 1.7 && ratio < 1.7, `${clip.name} at ${time.toFixed(3)}s deforms a facial edge by ${ratio.toFixed(3)}x`);
            }
        }
    }
    mixer.stopAllAction();
    assert.ok(maximumDisplacement > 0.01, 'the probe must evaluate animated skinned geometry');
});
