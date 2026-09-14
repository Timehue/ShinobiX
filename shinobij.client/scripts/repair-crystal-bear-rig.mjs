/** Rebind Crystal Bear's visible arms to anatomically placed arm joints.
 * Keeps the original mesh, atlas, topology and all non-arm weights. Run before
 * author-all-pet-animations.mjs legendary-9. Original source boundaries and
 * bindings make repeated repairs deterministic rather than cumulative. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

const path = resolve(import.meta.dirname, '../public/pet-models/roster/legendary-9.glb');
const bytes = await readFile(path);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binStart = 28 + jsonLength;
const original = json.extras.crystalBearArmRepair ?? {
    boundary: json.extras.properAnimationSourceBoundary,
    attributes: { ...json.meshes[0].primitives[0].attributes },
    inverseBindMatrices: json.skins[0].inverseBindMatrices,
    nodes: json.nodes.map(node => ({ translation: node.translation, rotation: node.rotation, scale: node.scale })),
};
const boundary = original.boundary;
let binary = bytes.subarray(binStart, binStart + boundary.binLength);
json.accessors = json.accessors.slice(0, boundary.accessorCount);
json.bufferViews = json.bufferViews.slice(0, boundary.bufferViewCount);
json.meshes[0].primitives[0].attributes = { ...original.attributes };
json.skins[0].inverseBindMatrices = original.inverseBindMatrices;
json.nodes.forEach((node, index) => {
    for (const key of ['translation', 'rotation', 'scale']) {
        if (original.nodes[index][key]) node[key] = original.nodes[index][key];
        else delete node[key];
    }
});
json.animations = [];
const align4 = n => (n + 3) & ~3;
function encode() {
    json.buffers = [{ byteLength: align4(binary.length) }];
    const text = Buffer.from(JSON.stringify(json));
    const length = align4(text.length);
    const output = Buffer.alloc(28 + length + align4(binary.length));
    output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(length, 12); output.writeUInt32LE(0x4e4f534a, 16);
    output.fill(0x20, 20, 20 + length); text.copy(output, 20);
    output.writeUInt32LE(align4(binary.length), 20 + length); output.writeUInt32LE(0x004e4942, 24 + length);
    binary.copy(output, 28 + length);
    return output;
}
globalThis.self = globalThis;
await MeshoptDecoder.ready;
const input = encode();
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const meshes = [];
gltf.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
if (meshes.length !== 1) throw new Error('Expected the single reviewed Crystal Bear surface');
const mesh = meshes[0], skeleton = mesh.skeleton;
const boneByName = new Map(skeleton.bones.map((bone, index) => [bone.name, { bone, index }]));
// The source mesh has a baked normalization in its inverse binds. Preserve it
// when relocating joints, otherwise changing weights also changes the rest mesh.
const correction = skeleton.bones[0].matrixWorld.clone().multiply(skeleton.boneInverses[0]);
for (const [side, sign] of [['L', 1], ['R', -1]]) {
    for (const [name, target] of [
        [`upper_arm${side}`, [sign * 0.205, 0.085, -0.02]],
        [`forearm${side}`, [sign * 0.270, -0.105, -0.005]],
        [`hand${side}`, [sign * 0.297, -0.250, 0.025]],
    ]) {
        const { bone } = boneByName.get(name);
        bone.position.copy(bone.parent.worldToLocal(new THREE.Vector3(...target)));
        gltf.scene.updateMatrixWorld(true);
        const sourceIndex = json.skins[0].joints[boneByName.get(name).index];
        json.nodes[sourceIndex].translation = bone.position.toArray();
    }
}
const inverseBinds = new Float32Array(skeleton.bones.length * 16);
skeleton.bones.forEach((bone, index) => bone.matrixWorld.clone().invert().multiply(correction).toArray(inverseBinds, index * 16));
const positions = mesh.geometry.attributes.position;
const oldJoints = mesh.geometry.attributes.skinIndex, oldWeights = mesh.geometry.attributes.skinWeight;
const joints = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4);
const smooth = (low, high, value) => { const p = Math.max(0, Math.min(1, (value - low) / (high - low))); return p * p * (3 - 2 * p); };
const counts = { L: 0, R: 0 };
for (let vertex = 0; vertex < positions.count; vertex++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(correction);
    const side = p.x >= 0 ? 'L' : 'R';
    // Blend across the shoulder/armpit seam; below that, the separated outer
    // silhouette belongs to the arm. The central belly, feet and crystals keep
    // their original weights. No UV or position edits are needed.
    const inner = 0.155 + 0.060 * smooth(0.06, -0.18, p.y);
    const armShare = smooth(inner, inner + 0.045, Math.abs(p.x))
        * (1 - smooth(0.10, 0.17, p.y)) * smooth(-0.37, -0.34, p.y);
    const influences = new Map();
    const add = (joint, weight) => influences.set(joint, (influences.get(joint) ?? 0) + weight);
    for (let slot = 0; slot < 4; slot++) add(oldJoints.getComponent(vertex, slot), oldWeights.getComponent(vertex, slot) * (1 - armShare));
    const elbow = smooth(0.01, -0.17, p.y), wrist = smooth(-0.18, -0.29, p.y);
    add(boneByName.get(`upper_arm${side}`).index, armShare * (1 - elbow));
    add(boneByName.get(`forearm${side}`).index, armShare * elbow * (1 - wrist));
    add(boneByName.get(`hand${side}`).index, armShare * elbow * wrist);
    const ranked = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    ranked.forEach(([joint, weight], slot) => { joints[vertex * 4 + slot] = joint; weights[vertex * 4 + slot] = weight / total; });
    if (armShare > 0.5) counts[side]++;
}
if (counts.L < 1000 || counts.R < 1000) throw new Error('Repair did not bind both visible arms');
function append(array, componentType, type, count) {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const offset = align4(binary.length);
    binary = Buffer.concat([binary, Buffer.alloc(offset - binary.length), data]);
    const view = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length }) - 1;
    return json.accessors.push({ bufferView: view, componentType, type, count }) - 1;
}
const attributes = json.meshes[0].primitives[0].attributes;
attributes.JOINTS_0 = append(joints, 5123, 'VEC4', positions.count);
attributes.WEIGHTS_0 = append(weights, 5126, 'VEC4', positions.count);
json.skins[0].inverseBindMatrices = append(inverseBinds, 5126, 'MAT4', skeleton.bones.length);
json.extras.crystalBearArmRepair = original;
json.extras.crystalBearArmRepairRevision = '20260909-arm-binding-v1';
json.extras.properAnimationSourceBoundary = { binLength: binary.length, accessorCount: json.accessors.length, bufferViewCount: json.bufferViews.length };
await writeFile(path, encode());
console.log(JSON.stringify({ vertices: positions.count, armDominantVertices: counts, next: 'node --import tsx scripts/author-all-pet-animations.mjs legendary-9' }));
