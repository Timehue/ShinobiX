import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const BIRD_FACE_REPAIR_REVISION = '20260916-bird-face-binding-v2';
/** Individually reviewed upright birds whose skull was split across wing bones.
 * These envelopes use canonical rig coordinates, before ancestor scale or runtime facing yaw. */
export const BIRD_FACE_REPAIRS = {
    'standard-7': { direction: 1 },
    'standard-10': { direction: 1, lowerBeak: true },
    'standard-17': { direction: 1 },
    'standard-35': { direction: 1, lowerBeak: true },
    'standard-36': { direction: -1, lowerBeak: true },
    'standard-37': { direction: 1 },
    'standard-39': { direction: 1 },
    'standard-44': { direction: 1, lowerBeak: true },
    'rare-3': { direction: 1 },
    'rare-7': { direction: 1, lowerBeak: true },
    'rare-10': { direction: 1, lowerBeak: true },
    'rare-17': { direction: 1, lowerBeak: true, beakCenter: -0.155, beakWidth: 0.11, beakOuter: 0.15, beakFront: 0.26, beakFullFront: 0.32, beakFullBottom: 0 },
    'rare-18': { direction: 1 },
    'rare-27': { direction: 1 },
    'rare-35': { direction: 1 },
    'rare-36': { direction: 1 },
    'rare-37': { direction: 1, lowerBeak: true, beakCenter: 0.175, beakWidth: 0.11, beakOuter: 0.15, beakFront: 0.26, beakFullFront: 0.32, beakFullBottom: 0 },
    'rare-38': { direction: 1 },
    'rare-39': { direction: 1 },
    'rare-44': { direction: 1, lowerBeak: true, beakCenter: 0.11, beakWidth: 0.13, beakOuter: 0.17, beakFront: 0.26, beakFullFront: 0.32, beakFullBottom: 0 },
    'legendary-1': { direction: 1, lowerBeak: true, beakCenter: -0.175, beakWidth: 0.13, beakOuter: 0.17, beakFront: 0.26, beakFullFront: 0.32, beakFullBottom: 0 },
    'legendary-6': { direction: 1, lowerBeak: true },
    'legendary-10': { direction: 1, lowerBeak: true, beakWidth: 0.16, beakOuter: 0.21, beakFront: 0.18, beakFullFront: 0.24, yaw: Math.PI / 8 },
    'legendary-14': { direction: 1, jawBottom: 0.24, skullBottom: 0.32 },
    'legendary-16': { direction: 1 },
    'legendary-21': { direction: 1, lowerBeak: true },
    'mythic-5': { direction: 1, lowerBeak: true },
    'starter-wind': { direction: 1, lowerBeak: true, beakWidth: 0.16, beakOuter: 0.21, beakFront: 0.18, beakFullFront: 0.24 },
    'starter-wind-r': { direction: 1, lowerBeak: true, beakWidth: 0.16, beakOuter: 0.21, beakFront: 0.18, beakFullFront: 0.24 },
    'starter-wind-l': { direction: 1, lowerBeak: true },
};
const smooth = (low, high, value) => { const p = Math.max(0, Math.min(1, (value - low) / (high - low))); return p * p * (3 - 2 * p); };
export function birdSkullShare(point, config) {
    // A few authored heads look diagonally relative to the canonical rig.
    // Align only the selection envelope; the mesh and authored pose stay intact.
    const sine = Math.sin(config.yaw ?? 0), cosine = Math.cos(config.yaw ?? 0);
    const side = point.x * cosine + point.z * sine;
    const forward = (-point.x * sine + point.z * cosine) * config.direction;
    // Fully bind the central eyes, beak and skull. Blend below the jaw and
    // outside the cheek; the separate outer wings and lower torso retain their
    // authored influences. The rear limit avoids shoulder-carried swords.
    const skull = smooth(config.jawBottom ?? 0.045, config.skullBottom ?? 0.16, point.y)
        * (1 - smooth(0.235, 0.30, Math.abs(side)))
        * smooth(-0.24, -0.12, forward);
    const beak = config.lowerBeak ? smooth(config.beakBottom ?? -0.08, config.beakFullBottom ?? 0.015, point.y)
        * (1 - smooth(config.beakWidth ?? 0.09, config.beakOuter ?? 0.15, Math.abs(side - (config.beakCenter ?? 0))))
        * smooth(config.beakFront ?? 0.075, config.beakFullFront ?? 0.14, forward) : 0;
    return Math.max(skull, beak);
}
export function birdEnvelopeMatrix(surface) {
    const root = surface.skeleton.bones.find(bone => bone.name === 'root');
    if (!root?.parent) throw new Error('Missing bird rig root');
    const bindCorrection = surface.skeleton.bones[0].matrixWorld.clone().multiply(surface.skeleton.boneInverses[0]);
    // Starter rigs resize the canonical bird differently on each axis. Evaluate
    // the skull envelope before that resize so both eyes and the jaw are covered.
    return root.parent.matrixWorld.clone().invert().multiply(bindCorrection);
}
const align4 = value => (value + 3) & ~3;
export function encodeGlb(json, binary) {
    const text = Buffer.from(JSON.stringify(json)), jsonLength = align4(text.length), binLength = align4(binary.length);
    const out = Buffer.alloc(28 + jsonLength + binLength);
    out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
    out.writeUInt32LE(jsonLength, 12); out.writeUInt32LE(0x4e4f534a, 16); out.fill(32, 20, 20 + jsonLength); text.copy(out, 20);
    out.writeUInt32LE(binLength, 20 + jsonLength); out.writeUInt32LE(0x004e4942, 24 + jsonLength); binary.copy(out, 28 + jsonLength);
    return out;
}
export async function loadBird(json, binary) {
    const scratch = structuredClone(json);
    scratch.materials = []; scratch.textures = []; scratch.images = [];
    scratch.meshes.forEach(mesh => mesh.primitives.forEach(primitive => { delete primitive.material; }));
    const bytes = encodeGlb(scratch, binary);
    await MeshoptDecoder.ready;
    const model = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
    model.scene.updateMatrixWorld(true);
    let surface;
    model.scene.traverse(node => { if (node.isSkinnedMesh) surface = node; });
    if (!surface) throw new Error('Missing bird surface');
    surface.skeleton.update();
    return { ...model, surface };
}

export async function repairBirdFace(path, id, outputPath = path) {
    const file = await readFile(path), length = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + length));
    let binary = file.subarray(28 + length, 28 + length + file.readUInt32LE(20 + length));
    const prior = json.extras?.birdFaceRepair;
    if (prior?.revision === BIRD_FACE_REPAIR_REVISION && JSON.stringify(prior.envelope) === JSON.stringify(BIRD_FACE_REPAIRS[id])) {
        if (outputPath !== path) await writeFile(outputPath, file);
        return { id, path: outputPath, unchanged: true };
    }
    const primitive = json.meshes[0].primitives[0];
    const original = json.extras?.birdFaceRepair?.original ?? {
        binLength: binary.length, accessorCount: json.accessors.length, bufferViewCount: json.bufferViews.length,
        attributes: { ...primitive.attributes },
    };
    // A later authored bank may append clips after our weight streams. Keep
    // those valid references when revising an existing repair envelope.
    if (!prior || (json.accessors.length === original.accessorCount + 2 && json.bufferViews.length === original.bufferViewCount + 2)) {
        binary = binary.subarray(0, original.binLength);
        json.accessors = json.accessors.slice(0, original.accessorCount);
        json.bufferViews = json.bufferViews.slice(0, original.bufferViewCount);
    }
    primitive.attributes = { ...original.attributes };
    const { surface } = await loadBird(json, binary);
    const positions = surface.geometry.attributes.position, sourceJoints = surface.geometry.attributes.skinIndex, sourceWeights = surface.geometry.attributes.skinWeight;
    const correction = birdEnvelopeMatrix(surface);
    const head = surface.skeleton.bones.findIndex(bone => bone.name === 'head');
    if (head < 0) throw new Error(id + ': missing head bone');
    const joints = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4);
    let changed = 0, rigidSkull = 0;
    for (let vertex = 0; vertex < positions.count; vertex++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(correction);
        const share = birdSkullShare(point, BIRD_FACE_REPAIRS[id]);
        if (share === 0) {
            for (let slot = 0; slot < 4; slot++) {
                joints[vertex * 4 + slot] = sourceJoints.getComponent(vertex, slot);
                weights[vertex * 4 + slot] = sourceWeights.getComponent(vertex, slot);
            }
            continue;
        }
        const influences = new Map();
        for (let slot = 0; slot < 4; slot++) {
            const joint = sourceJoints.getComponent(vertex, slot);
            influences.set(joint, (influences.get(joint) ?? 0) + sourceWeights.getComponent(vertex, slot) * (1 - share));
        }
        influences.set(head, (influences.get(head) ?? 0) + share);
        const ranked = [...influences].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
        ranked.forEach(([joint, weight], slot) => { joints[vertex * 4 + slot] = joint; weights[vertex * 4 + slot] = weight / total; });
        if (share > 0) changed++;
        if (share > 0.999) rigidSkull++;
    }
    if (rigidSkull < 300) throw new Error(id + ': skull envelope did not capture sufficient geometry');
    await MeshoptEncoder.ready;
    const append = (array, componentType) => {
        const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), offset = align4(binary.length);
        const byteStride = array.BYTES_PER_ELEMENT * 4;
        // Lossless packing keeps the authored Float32 weights and Uint16 joints
        // exact while avoiding two large raw streams in every mobile download.
        const packed = MeshoptEncoder.encodeGltfBuffer(bytes, positions.count, byteStride, 'ATTRIBUTES', 0);
        const decoded = new Uint8Array(bytes.length);
        MeshoptDecoder.decodeGltfBuffer(decoded, positions.count, byteStride, packed, 'ATTRIBUTES');
        if (!Buffer.from(decoded).equals(bytes)) throw new Error(id + ': binding compression changed decoded bytes');
        binary = Buffer.concat([binary, Buffer.alloc(offset - binary.length), packed]);
        const bufferView = json.bufferViews.push({ buffer: 1, byteOffset: 0, byteLength: bytes.length,
            extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: packed.length,
                byteStride, count: positions.count, mode: 'ATTRIBUTES' } } }) - 1;
        return json.accessors.push({ bufferView, componentType, type: 'VEC4', count: positions.count }) - 1;
    };
    primitive.attributes.JOINTS_0 = append(joints, 5123);
    primitive.attributes.WEIGHTS_0 = append(weights, 5126);
    json.extras = { ...json.extras, birdFaceRepair: { revision: BIRD_FACE_REPAIR_REVISION, original, envelope: BIRD_FACE_REPAIRS[id] } };
    if (json.extras.properAnimationSourceBoundary) json.extras.properAnimationSourceBoundary = { binLength: binary.length, accessorCount: json.accessors.length, bufferViewCount: json.bufferViews.length };
    json.buffers[0].byteLength = align4(binary.length);
    json.buffers[1] = { byteLength: Math.max(...json.bufferViews.filter(view => view.buffer === 1).map(view => (view.byteOffset ?? 0) + view.byteLength)), extensions: { EXT_meshopt_compression: { fallback: true } } };
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
    await writeFile(outputPath, encodeGlb(json, binary));
    return { id, path: outputPath, changed, rigidSkull, vertices: positions.count };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    const clientRoot = resolve(import.meta.dirname, '..');
    const candidate = process.argv.includes('--candidate');
    const requested = process.argv.slice(2).filter(value => value !== '--candidate');
    const ids = requested.length ? requested : Object.keys(BIRD_FACE_REPAIRS);
    const outputRoot = resolve(clientRoot, '.tmp/bird-face-repair');
    await mkdir(outputRoot, { recursive: true });
    for (const id of ids) {
        if (!BIRD_FACE_REPAIRS[id]) throw new Error('Unreviewed bird id: ' + id);
        for (const kind of id === 'standard-7' ? ['roster', 'showdown-v2'] : id.startsWith('starter-') ? ['base'] : ['roster']) {
            const path = resolve(clientRoot, 'public/pet-models', kind === 'base' ? '' : kind, id + '.glb');
            const output = candidate ? resolve(outputRoot, kind + '-' + id + '.glb') : path;
            if (!candidate) {
                const backupRoot = resolve(outputRoot, 'originals');
                await mkdir(backupRoot, { recursive: true });
                await copyFile(path, resolve(backupRoot, kind + '-' + id + '.glb'), constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
            }
            console.log(JSON.stringify(await repairBirdFace(path, id, output)));
        }
    }
}
