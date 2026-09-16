/** Restore Raijin Hound's facial landmarks and cohesive head binding.
 * The source reconstruction faces +X but inherited a +Z weight mask, splitting
 * the muzzle between pelvis and head. Keep the original surface/atlas, blend
 * its skull to the head joint, and fit small gold eyes and a dark nose to it.
 * Run this, then author-showdown-pet-animations.mjs starter-lightning-l.
 * The stored original boundary makes repeated repairs deterministic.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';

const path = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '../public/pet-models/starter-lightning-l.glb');
const bytes = await readFile(path), jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const source = json.extras?.raijinFaceRepair?.source ?? {
    binLength: bytes.readUInt32LE(20 + jsonLength),
    accessorCount: json.accessors.length,
    bufferViewCount: json.bufferViews.length,
    materialCount: json.materials.length,
    attributes: { ...json.meshes[0].primitives[0].attributes },
};
let binary = bytes.subarray(28 + jsonLength, 28 + jsonLength + source.binLength);
json.accessors = json.accessors.slice(0, source.accessorCount);
json.bufferViews = json.bufferViews.slice(0, source.bufferViewCount);
json.materials = json.materials.slice(0, source.materialCount);
json.meshes[0].primitives = [json.meshes[0].primitives[0]];
json.meshes[0].primitives[0].attributes = { ...source.attributes };
const align4 = value => (value + 3) & ~3;
function encode(document = json, buffer = binary) {
    document.buffers[0].byteLength = align4(buffer.length);
    const text = Buffer.from(JSON.stringify(document)), length = align4(text.length);
    const output = Buffer.alloc(28 + length + align4(buffer.length));
    output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(length, 12); output.writeUInt32LE(0x4e4f534a, 16);
    output.fill(32, 20, 20 + length); text.copy(output, 20);
    output.writeUInt32LE(align4(buffer.length), 20 + length); output.writeUInt32LE(0x004e4942, 24 + length);
    buffer.copy(output, 28 + length);
    return output;
}
// Geometry inspection needs no browser texture loader. Keep the production atlas intact.
const scratch = structuredClone(json);
scratch.materials = []; scratch.textures = []; scratch.images = [];
for (const mesh of scratch.meshes) for (const primitive of mesh.primitives) delete primitive.material;
globalThis.self = globalThis;
await MeshoptDecoder.ready;
const input = encode(scratch);
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(input.buffer.slice(input.byteOffset, input.byteOffset + input.length), '');
gltf.scene.updateMatrixWorld(true);
let surface;
gltf.scene.traverse(node => { if (node.isSkinnedMesh) surface = node; });
if (!surface) throw new Error('Missing Raijin surface');
const head = surface.skeleton.bones.findIndex(bone => bone.name === 'head');
if (head < 0) throw new Error('Missing Raijin head joint');
const correction = surface.skeleton.bones[0].matrixWorld.clone().multiply(surface.skeleton.boneInverses[0]);
const smooth = (low, high, value) => {
    const p = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return p * p * (3 - 2 * p);
};
function append(array, componentType, type, count) {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength), offset = align4(binary.length);
    binary = Buffer.concat([binary, Buffer.alloc(offset - binary.length), data]);
    const bufferView = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length }) - 1;
    return json.accessors.push({ bufferView, componentType, type, count }) - 1;
}
const positions = surface.geometry.attributes.position;
const oldJoints = surface.geometry.attributes.skinIndex, oldWeights = surface.geometry.attributes.skinWeight;
const joints = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4);
for (let vertex = 0; vertex < positions.count; vertex++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(correction);
    // The jaw and ears move with one skull, blending broadly through the neck.
    // The mask stays above the front legs and does not touch the tail or back.
    const headShare = smooth(0.065, 0.20, p.x) * smooth(-0.16, -0.045, p.y);
    const influences = new Map();
    for (let slot = 0; slot < 4; slot++) {
        const joint = oldJoints.getComponent(vertex, slot);
        influences.set(joint, (influences.get(joint) ?? 0) + oldWeights.getComponent(vertex, slot) * (1 - headShare));
    }
    influences.set(head, (influences.get(head) ?? 0) + headShare);
    const ranked = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    ranked.forEach(([joint, weight], slot) => { joints[vertex * 4 + slot] = joint; weights[vertex * 4 + slot] = weight / total; });
}
Object.assign(json.meshes[0].primitives[0].attributes, {
    JOINTS_0: append(joints, 5123, 'VEC4', positions.count),
    WEIGHTS_0: append(weights, 5126, 'VEC4', positions.count),
});
const raw = new THREE.Mesh(surface.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
raw.updateMatrixWorld();
const ray = new THREE.Raycaster();
function front(y, z) {
    ray.set(new THREE.Vector3(1.2, y, z), new THREE.Vector3(-1, 0, 0));
    const hit = ray.intersectObject(raw)[0];
    if (!hit) throw new Error(`Facial landmark misses the source surface: ${y}, ${z}`);
    return hit.point.x;
}
function material(name, color, roughness, emission = 0) {
    const c = new THREE.Color(color);
    const value = { name, pbrMetallicRoughness: { baseColorFactor: [...c.toArray(), 1], roughnessFactor: roughness, metallicFactor: 0 } };
    if (emission) value.emissiveFactor = c.clone().multiplyScalar(emission).toArray();
    return json.materials.push(value) - 1;
}
const ink = material('Raijin face | charcoal', 0x18130f, .48);
const gold = material('Raijin face | storm gold eyes', 0xffdd55, .38, .18);
const pupil = material('Raijin face | pupils', 0x281608, .5);
const glint = material('Raijin face | eye glint', 0xfff3b0, .3, .08);
const features = new Map();
function collect(name, geometry, mat) {
    // Sphere UVs are unused; every facial feature is a solid native material.
    geometry.deleteAttribute('uv');
    const group = features.get(mat) ?? { names: [], geometries: [] };
    group.names.push(name); group.geometries.push(geometry); features.set(mat, group);
}
function eye(name, y, z, height, width, slant, offset, mat) {
    const points = [front(y, z) + offset, y, z], indices = [], steps = 40, rings = 6;
    // Sample the curved skull at every ring so the tiny features do not cut
    // through the fur when seen from either side or animated with the head.
    for (let ring = 1; ring <= rings; ring++) {
        const r = ring / rings;
        for (let i = 0; i < steps; i++) {
            const t = i / steps * Math.PI * 2;
            const zz = z + r * Math.cos(t) * width;
            const yy = y + r * (Math.sin(t) * Math.abs(Math.sin(t)) * height + Math.cos(t) * slant);
            points.push(front(yy, zz) + offset, yy, zz);
            const a = 1 + (ring - 1) * steps + i, b = 1 + (ring - 1) * steps + (i + 1) % steps;
            if (ring === 1) indices.push(0, b, a);
            else { const c = a - steps, d = b - steps; indices.push(c, d, a, a, d, b); }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); collect(name, geometry, mat);
}
// Existing portrait: gold almond eyes, dark lids, and a small charcoal nose.
for (const [side, sign] of [['left', -1], ['right', 1]]) {
    const z = .06 + sign * .205, y = .205;
    eye(`eye-outline-${side}`, y, z, .036, .095, sign * .022, .010, ink);
    eye(`eye-gold-${side}`, y, z, .023, .078, sign * .018, .016, gold);
    eye(`eye-pupil-${side}`, y, z, .019, .006, 0, .023, pupil);
    eye(`eye-glint-${side}`, y + .009, z - .012, .004, .009, 0, .030, glint);
}
const nose = new THREE.SphereGeometry(1, 16, 10);
nose.scale(.044, .034, .056); nose.translate(front(.1, .06) + .015, .105, .06);
collect('nose', nose, ink);
for (const [mat, group] of features) {
    // One primitive per material keeps nine landmarks to four additional draws.
    const geometry = mergeGeometries(group.geometries), count = geometry.attributes.position.count;
    const featureWeights = new Float32Array(count * 4), featureJoints = new Uint16Array(count * 4);
    for (let vertex = 0; vertex < count; vertex++) { featureWeights[vertex * 4] = 1; featureJoints[vertex * 4] = head; }
    const attributes = {
        POSITION: append(geometry.attributes.position.array, 5126, 'VEC3', count),
        NORMAL: append(geometry.attributes.normal.array, 5126, 'VEC3', count),
        // The downstream LOD pipeline expects UVs on every skinned primitive.
        TEXCOORD_0: append(new Float32Array(count * 2), 5126, 'VEC2', count),
        JOINTS_0: append(featureJoints, 5123, 'VEC4', count),
        WEIGHTS_0: append(featureWeights, 5126, 'VEC4', count),
    };
    geometry.computeBoundingBox();
    Object.assign(json.accessors[attributes.POSITION], { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() });
    json.meshes[0].primitives.push({ attributes,
        indices: append(new Uint16Array(geometry.index.array), 5123, 'SCALAR', geometry.index.count),
        material: mat, mode: 4, extras: { raijinFaceFeatures: group.names },
    });
}
json.extras = { ...json.extras, raijinFaceRepair: { revision: '20260915-raijin-face-repair-v1', source } };
await writeFile(path, encode());
console.log(`Repaired Raijin face: ${positions.count} original vertices retained; ${features.size} fitted feature materials.`);
