import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

globalThis.self = globalThis;
await MeshoptDecoder.ready;
async function load(original = false, lod = false) {
    const bytes = await readFile(new URL(`../public/pet-models/${lod ? 'warfront-lod/' : ''}roster/legendary-9.glb`, import.meta.url));
    const jsonLength = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    const binary = bytes.subarray(28 + jsonLength);
    // Geometry/animation tests do not need a browser texture decoder.
    json.materials = [{ pbrMetallicRoughness: {} }];
    json.meshes.forEach(mesh => mesh.primitives.forEach(primitive => { primitive.material = 0; }));
    if (original) {
        const source = json.extras.crystalBearArmRepair;
        json.nodes.forEach((node, i) => {
            for (const key of ['translation', 'rotation', 'scale']) {
                if (source.nodes[i][key]) node[key] = source.nodes[i][key];
                else delete node[key];
            }
        });
        json.meshes[0].primitives[0].attributes = source.attributes;
        json.skins[0].inverseBindMatrices = source.inverseBindMatrices;
        json.animations = [];
    }
    const text = Buffer.from(JSON.stringify(json));
    const padded = (text.length + 3) & ~3;
    const output = Buffer.alloc(28 + padded + binary.length);
    output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(padded, 12); output.writeUInt32LE(0x4e4f534a, 16);
    output.fill(0x20, 20, 20 + padded); text.copy(output, 20);
    output.writeUInt32LE(binary.length, 20 + padded); output.writeUInt32LE(0x004e4942, 24 + padded); binary.copy(output, 28 + padded);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(output.buffer, '');
    let surface;
    gltf.scene.traverse(node => { if (node.isSkinnedMesh) surface = node; });
    const update = () => { gltf.scene.updateMatrixWorld(true); surface.skeleton.update(); };
    update();
    return { ...gltf, surface, update };
}

test('Crystal Bear keeps its rest mesh and binds both visible arms with normalized weights', async () => {
    const before = await load(true), after = await load();
    const oldPoint = new THREE.Vector3(), newPoint = new THREE.Vector3();
    const skin = after.surface.geometry.attributes.skinIndex, weights = after.surface.geometry.attributes.skinWeight;
    const armCounts = { L: 0, R: 0 };
    let maximumRestDrift = 0;
    for (let i = 0; i < skin.count; i++) {
        before.surface.getVertexPosition(i, oldPoint); after.surface.getVertexPosition(i, newPoint);
        maximumRestDrift = Math.max(maximumRestDrift, oldPoint.distanceTo(newPoint));
        const shares = { L: 0, R: 0 };
        let total = 0;
        for (let slot = 0; slot < 4; slot++) {
            const weight = weights.getComponent(i, slot); total += weight;
            const name = after.surface.skeleton.bones[skin.getComponent(i, slot)].name;
            if (/^(upper_arm|forearm|hand)[LR]$/.test(name)) shares[name.at(-1)] += weight;
        }
        assert.ok(Math.abs(total - 1) < 1e-6);
        for (const side of ['L', 'R']) if (shares[side] > 0.5) armCounts[side]++;
        if (Math.abs(oldPoint.x) < 0.13 || oldPoint.y > 0.18 || oldPoint.y < -0.37) assert.equal(shares.L + shares.R, 0, 'belly, head and feet retain their existing skinning');
        if (Math.abs(oldPoint.x) > 0.27 && oldPoint.y < -0.23 && oldPoint.y > -0.33) assert.ok(shares.L + shares.R > 0.99, 'paw tips must follow the wrist instead of stretching back toward the torso');
    }
    assert.ok(maximumRestDrift < 1e-5, `rest-mesh drift: ${maximumRestDrift}`);
    assert.ok(armCounts.L > 2500 && armCounts.R > 2500);
});

test('the lower-detail battle asset retains weighted paws and the forward strike', async () => {
    const model = await load(false, true);
    const skin = model.surface.geometry.attributes.skinIndex, weights = model.surface.geometry.attributes.skinWeight;
    const paws = { L: [], R: [] };
    for (let i = 0; i < skin.count; i++) for (let slot = 0; slot < 4; slot++) {
        const name = model.surface.skeleton.bones[skin.getComponent(i, slot)].name;
        if (/^hand[LR]$/.test(name) && weights.getComponent(i, slot) > 0.5) paws[name.at(-1)].push(i);
    }
    const centre = ids => ids.reduce((sum, i) => sum.add(model.surface.getVertexPosition(i, new THREE.Vector3())), new THREE.Vector3()).divideScalar(ids.length);
    const before = Object.fromEntries(['L', 'R'].map(side => [side, centre(paws[side])]));
    const clip = model.animations.find(clip => clip.name === 'attack');
    const mixer = new THREE.AnimationMixer(model.scene), action = mixer.clipAction(clip).play();
    action.time = clip.duration * 0.54; mixer.update(0); model.update();
    for (const side of ['L', 'R']) {
        assert.ok(paws[side].length > 40);
        assert.ok(centre(paws[side]).z - before[side].z > 0.25, `${side} LOD paw does not strike forward`);
    }
});

test('both visible paws extend toward the opponent at contact and recover without stretched bounds', async () => {
    const model = await load();
    const skin = model.surface.geometry.attributes.skinIndex, weights = model.surface.geometry.attributes.skinWeight;
    const vertices = { L: [], R: [] };
    for (let i = 0; i < skin.count; i++) for (let slot = 0; slot < 4; slot++) {
        const bone = model.surface.skeleton.bones[skin.getComponent(i, slot)].name;
        if (/^hand[LR]$/.test(bone) && weights.getComponent(i, slot) > 0.5) vertices[bone.at(-1)].push(i);
    }
    const centre = ids => {
        const sum = new THREE.Vector3();
        for (const index of ids) sum.add(model.surface.getVertexPosition(index, new THREE.Vector3()));
        return sum.divideScalar(ids.length);
    };
    const chest = () => model.scene.getObjectByName('chest').getWorldPosition(new THREE.Vector3());
    const baseline = Object.fromEntries(['L', 'R'].map(side => [side, centre(vertices[side]).sub(chest())]));
    const clip = model.animations.find(clip => clip.name === 'attack');
    const mixer = new THREE.AnimationMixer(model.scene), action = mixer.clipAction(clip).play();
    action.time = clip.duration * 0.54; mixer.update(0); model.update();
    for (const side of ['L', 'R']) {
        assert.ok(vertices[side].length > 100);
        const delta = centre(vertices[side]).sub(chest()).sub(baseline[side]);
        assert.ok(delta.z > 0.22, `${side} paw forward travel ${delta.z}`);
        assert.ok(delta.y > 0.09, `${side} paw lift ${delta.y}`);
    }
    // Measure actual deformed geometry through the whole take, including the
    // shoulder blend. Merely moving an unweighted bone would not pass this.
    for (let i = 0; i <= 40; i++) {
        action.time = clip.duration * i / 40; mixer.update(0); model.update();
        const bounds = new THREE.Box3();
        for (let vertex = 0; vertex < skin.count; vertex += 4) bounds.expandByPoint(model.surface.getVertexPosition(vertex, new THREE.Vector3()));
        const size = bounds.getSize(new THREE.Vector3());
        assert.ok(size.x < 1.05 && size.y < 1.2 && size.z < 1.1, `unbounded pose at ${i / 40}: ${size.toArray()}`);
    }
});
