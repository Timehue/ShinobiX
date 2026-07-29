import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";

globalThis.self = globalThis;

const SOURCE_URL = new URL("../public/pet-models/gate-warden.glb", import.meta.url);
const OUTPUT_URL = new URL("../public/pet-models/gate-warden-rigged.glb", import.meta.url);
const AUTHORING_URL = new URL("../tmp/gate-warden-rigged-source.glb", import.meta.url);
const OPTIMIZED_URL = new URL("../tmp/gate-warden-rigged-optimized.glb", import.meta.url);
const execFile = promisify(execFileCallback);

function parseGlb(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
        throw new Error("Gate Warden source is not a glTF 2.0 binary.");
    }
    const jsonLength = view.getUint32(12, true);
    const jsonType = view.getUint32(16, true);
    if (jsonType !== 0x4e4f534a) throw new Error("GLB JSON chunk is missing.");
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const binHeader = 20 + jsonLength;
    const binLength = view.getUint32(binHeader, true);
    const binType = view.getUint32(binHeader + 4, true);
    if (binType !== 0x004e4942) throw new Error("GLB binary chunk is missing.");
    return { json, bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

const BONES = Object.freeze([
    { name: "GW_Root", parent: null, translation: [0, -0.42, 0] },
    { name: "GW_Spine", parent: "GW_Root", translation: [0, 0.43, 0] },
    { name: "GW_Chest", parent: "GW_Spine", translation: [0, 0.34, 0] },
    { name: "GW_Head", parent: "GW_Chest", translation: [0, 0.39, 0.01] },
    { name: "GW_Arm_L", parent: "GW_Chest", translation: [-0.4, 0.05, 0] },
    { name: "GW_Forearm_L", parent: "GW_Arm_L", translation: [-0.24, -0.27, 0.02] },
    { name: "GW_Hand_L", parent: "GW_Forearm_L", translation: [-0.08, -0.35, 0.04] },
    { name: "GW_Arm_R", parent: "GW_Chest", translation: [0.4, 0.05, 0] },
    { name: "GW_Forearm_R", parent: "GW_Arm_R", translation: [0.24, -0.27, 0.02] },
    { name: "GW_Hand_R", parent: "GW_Forearm_R", translation: [0.08, -0.35, 0.04] },
    { name: "GW_Thigh_L", parent: "GW_Root", translation: [-0.27, -0.04, 0] },
    { name: "GW_Shin_L", parent: "GW_Thigh_L", translation: [-0.02, -0.32, 0] },
    { name: "GW_Foot_L", parent: "GW_Shin_L", translation: [0, -0.17, 0.08] },
    { name: "GW_Thigh_R", parent: "GW_Root", translation: [0.27, -0.04, 0] },
    { name: "GW_Shin_R", parent: "GW_Thigh_R", translation: [0.02, -0.32, 0] },
    { name: "GW_Foot_R", parent: "GW_Shin_R", translation: [0, -0.17, 0.08] },
]);

const BONE_INDEX = new Map(BONES.map((bone, index) => [bone.name, index]));

function addInfluence(influences, name, weight) {
    if (weight <= 0.0001) return;
    const index = BONE_INDEX.get(name);
    if (index === undefined) throw new Error(`Unknown bone ${name}`);
    influences.set(index, (influences.get(index) ?? 0) + weight);
}

function vertexInfluences(x, y) {
    const influences = new Map();
    const ax = Math.abs(x);
    const side = x < 0 ? "L" : "R";
    const armTerritory = ax > (y > 0.5 ? 0.52 : y > 0.15 ? 0.38 : 0.48) && y > -0.62;
    const legTerritory = y < -0.28 && ax < 0.59;

    if (armTerritory) {
        if (y > 0.16) {
            const shoulderBlend = smoothstep(0.16, 0.46, y);
            addInfluence(influences, `GW_Arm_${side}`, 0.84);
            addInfluence(influences, "GW_Chest", 0.16 * shoulderBlend);
        } else if (y > -0.2) {
            const lower = smoothstep(0.2, -0.2, y);
            addInfluence(influences, `GW_Arm_${side}`, 1 - lower);
            addInfluence(influences, `GW_Forearm_${side}`, lower);
        } else {
            const hand = smoothstep(-0.2, -0.55, y);
            addInfluence(influences, `GW_Forearm_${side}`, 1 - hand);
            addInfluence(influences, `GW_Hand_${side}`, hand);
        }
    } else if (legTerritory) {
        if (y > -0.62) {
            const thigh = smoothstep(-0.28, -0.62, y);
            addInfluence(influences, "GW_Root", 0.2 * (1 - thigh));
            addInfluence(influences, `GW_Thigh_${side}`, 0.8 + 0.2 * thigh);
        } else if (y > -0.86) {
            const shin = smoothstep(-0.58, -0.82, y);
            addInfluence(influences, `GW_Thigh_${side}`, 1 - shin);
            addInfluence(influences, `GW_Shin_${side}`, shin);
        } else {
            const foot = smoothstep(-0.84, -1, y);
            addInfluence(influences, `GW_Shin_${side}`, 1 - foot);
            addInfluence(influences, `GW_Foot_${side}`, foot);
        }
    } else if (y > 0.53) {
        const head = smoothstep(0.48, 0.68, y);
        addInfluence(influences, "GW_Chest", 1 - head);
        addInfluence(influences, "GW_Head", head);
    } else if (y > 0.18) {
        const chest = smoothstep(0.12, 0.38, y);
        addInfluence(influences, "GW_Spine", 1 - chest);
        addInfluence(influences, "GW_Chest", chest);
    } else if (y > -0.28) {
        const spine = smoothstep(-0.28, 0.12, y);
        addInfluence(influences, "GW_Root", 1 - spine);
        addInfluence(influences, "GW_Spine", spine);
    } else {
        addInfluence(influences, "GW_Root", 1);
    }

    const ranked = [...influences.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = ranked.reduce((sum, entry) => sum + entry[1], 0) || 1;
    return ranked.map(([index, weight]) => [index, weight / total]);
}

function quaternion(x = 0, y = 0, z = 0) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ")).toArray();
}

function rootTranslation(y = 0, z = 0, x = 0) {
    const bind = BONES[0].translation;
    return [bind[0] + x, bind[1] + y, bind[2] + z];
}

function rotations(values) {
    return values.flatMap(([x = 0, y = 0, z = 0]) => quaternion(x, y, z));
}

const CLIPS = Object.freeze([
    {
        name: "GW_Idle",
        times: [0, 0.6, 1.2, 1.8, 2.4],
        tracks: [
            ["GW_Root", "translation", [rootTranslation(), rootTranslation(0.014, 0.006), rootTranslation(), rootTranslation(0.012, -0.004), rootTranslation()]],
            ["GW_Chest", "rotation", rotations([[0.025, 0, 0], [0.04, 0.015, 0.025], [0.025, 0, 0], [0.01, -0.015, -0.025], [0.025, 0, 0]])],
            ["GW_Head", "rotation", rotations([[0, 0, 0], [-0.025, -0.025, -0.018], [0, 0, 0], [0.02, 0.025, 0.018], [0, 0, 0]])],
            ["GW_Arm_L", "rotation", rotations([[0.03, 0, 0.02], [0.07, 0, 0.035], [0.03, 0, 0.02], [-0.01, 0, 0.005], [0.03, 0, 0.02]])],
            ["GW_Arm_R", "rotation", rotations([[-0.01, 0, -0.02], [0.03, 0, -0.005], [-0.01, 0, -0.02], [-0.05, 0, -0.035], [-0.01, 0, -0.02]])],
        ],
    },
    {
        name: "GW_Walk",
        times: [0, 0.3, 0.6, 0.9, 1.2],
        tracks: [
            ["GW_Root", "translation", [rootTranslation(), rootTranslation(0.028, 0.015), rootTranslation(), rootTranslation(0.028, -0.01), rootTranslation()]],
            ["GW_Chest", "rotation", rotations([[0.07, 0, 0.05], [0.1, 0.025, 0], [0.07, 0, -0.05], [0.1, -0.025, 0], [0.07, 0, 0.05]])],
            ["GW_Head", "rotation", rotations([[-0.04, 0, -0.025], [-0.02, -0.02, 0], [-0.04, 0, 0.025], [-0.02, 0.02, 0], [-0.04, 0, -0.025]])],
            ["GW_Arm_L", "rotation", rotations([[-0.28, 0, 0.05], [0, 0, 0.03], [0.28, 0, 0.05], [0, 0, 0.03], [-0.28, 0, 0.05]])],
            ["GW_Arm_R", "rotation", rotations([[0.28, 0, -0.05], [0, 0, -0.03], [-0.28, 0, -0.05], [0, 0, -0.03], [0.28, 0, -0.05]])],
            ["GW_Thigh_L", "rotation", rotations([[0.28, 0, 0], [0, 0, 0], [-0.28, 0, 0], [0, 0, 0], [0.28, 0, 0]])],
            ["GW_Thigh_R", "rotation", rotations([[-0.28, 0, 0], [0, 0, 0], [0.28, 0, 0], [0, 0, 0], [-0.28, 0, 0]])],
            ["GW_Shin_L", "rotation", rotations([[0.08, 0, 0], [0.34, 0, 0], [0.08, 0, 0], [0.02, 0, 0], [0.08, 0, 0]])],
            ["GW_Shin_R", "rotation", rotations([[0.08, 0, 0], [0.02, 0, 0], [0.08, 0, 0], [0.34, 0, 0], [0.08, 0, 0]])],
        ],
    },
    {
        name: "GW_Windup",
        times: [0, 0.3, 0.62, 0.8],
        tracks: [
            ["GW_Root", "translation", [rootTranslation(), rootTranslation(-0.02, -0.02), rootTranslation(-0.07, -0.075), rootTranslation(-0.07, -0.075)]],
            ["GW_Spine", "rotation", rotations([[0, 0, 0], [-0.08, 0, 0], [-0.18, 0, 0], [-0.18, 0, 0]])],
            ["GW_Chest", "rotation", rotations([[0.02, 0, 0], [-0.12, 0, 0], [-0.3, 0, 0], [-0.3, 0, 0]])],
            ["GW_Head", "rotation", rotations([[0, 0, 0], [0.08, 0, 0], [0.16, 0, 0], [0.16, 0, 0]])],
            ["GW_Arm_L", "rotation", rotations([[0, 0, 0.04], [-0.32, 0, 0.14], [-0.82, 0, 0.24], [-0.82, 0, 0.24]])],
            ["GW_Arm_R", "rotation", rotations([[0, 0, -0.04], [-0.32, 0, -0.14], [-0.82, 0, -0.24], [-0.82, 0, -0.24]])],
            ["GW_Forearm_L", "rotation", rotations([[0, 0, 0], [-0.12, 0, 0], [-0.34, 0, 0], [-0.34, 0, 0]])],
            ["GW_Forearm_R", "rotation", rotations([[0, 0, 0], [-0.12, 0, 0], [-0.34, 0, 0], [-0.34, 0, 0]])],
        ],
    },
    {
        name: "GW_Slam",
        times: [0, 0.15, 0.27, 0.38, 0.58],
        tracks: [
            ["GW_Root", "translation", [rootTranslation(-0.07, -0.075), rootTranslation(-0.11, 0.06), rootTranslation(-0.15, 0.11), rootTranslation(-0.08, 0.04), rootTranslation()]],
            ["GW_Spine", "rotation", rotations([[-0.18, 0, 0], [0.22, 0, 0], [0.38, 0, 0], [0.12, 0, 0], [0, 0, 0]])],
            ["GW_Chest", "rotation", rotations([[-0.3, 0, 0], [0.34, 0, 0], [0.52, 0, 0], [0.16, 0, 0], [0.02, 0, 0]])],
            ["GW_Head", "rotation", rotations([[0.16, 0, 0], [-0.12, 0, 0], [-0.25, 0, 0], [0.08, 0, 0], [0, 0, 0]])],
            ["GW_Arm_L", "rotation", rotations([[-0.82, 0, 0.24], [0.65, 0, 0.1], [1.08, 0, 0.04], [0.36, 0, 0.03], [0, 0, 0.04]])],
            ["GW_Arm_R", "rotation", rotations([[-0.82, 0, -0.24], [0.65, 0, -0.1], [1.08, 0, -0.04], [0.36, 0, -0.03], [0, 0, -0.04]])],
            ["GW_Forearm_L", "rotation", rotations([[-0.34, 0, 0], [0.28, 0, 0], [0.55, 0, 0], [0.18, 0, 0], [0, 0, 0]])],
            ["GW_Forearm_R", "rotation", rotations([[-0.34, 0, 0], [0.28, 0, 0], [0.55, 0, 0], [0.18, 0, 0], [0, 0, 0]])],
        ],
    },
    {
        name: "GW_Hit",
        times: [0, 0.08, 0.22, 0.45],
        tracks: [
            ["GW_Root", "translation", [rootTranslation(), rootTranslation(-0.025, -0.1, -0.025), rootTranslation(-0.012, -0.035, 0.012), rootTranslation()]],
            ["GW_Spine", "rotation", rotations([[0, 0, 0], [-0.16, 0, 0.16], [0.08, 0, -0.07], [0, 0, 0]])],
            ["GW_Chest", "rotation", rotations([[0.02, 0, 0], [-0.22, 0, 0.23], [0.12, 0, -0.1], [0.02, 0, 0]])],
            ["GW_Head", "rotation", rotations([[0, 0, 0], [0.2, 0, -0.22], [-0.08, 0, 0.1], [0, 0, 0]])],
            ["GW_Arm_L", "rotation", rotations([[0, 0, 0.04], [-0.18, 0, 0.16], [0.08, 0, 0], [0, 0, 0.04]])],
            ["GW_Arm_R", "rotation", rotations([[0, 0, -0.04], [0.12, 0, -0.05], [-0.05, 0, -0.1], [0, 0, -0.04]])],
        ],
    },
]);

const sourceBytes = await readFile(SOURCE_URL);
const source = parseGlb(sourceBytes);
await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const loaded = await loader.parseAsync(
    sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength),
    "",
);
let sourceMesh = null;
loaded.scene.traverse((node) => {
    if (sourceMesh || !(node instanceof THREE.Mesh)) return;
    sourceMesh = node;
});
if (!sourceMesh) throw new Error("Gate Warden source mesh was not found.");

const position = sourceMesh.geometry.getAttribute("position");
const normal = sourceMesh.geometry.getAttribute("normal");
const uv = sourceMesh.geometry.getAttribute("uv");
const sourceIndex = sourceMesh.geometry.getIndex();
if (!position || !normal || !uv || !sourceIndex) {
    throw new Error("Gate Warden source is missing required indexed geometry attributes.");
}

const positions = new Float32Array(position.count * 3);
const normals = new Float32Array(normal.count * 3);
const uvs = new Float32Array(uv.count * 2);
const joints = new Uint16Array(position.count * 4);
const weights = new Float32Array(position.count * 4);
for (let i = 0; i < position.count; i++) {
    positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
    normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
    uvs.set([uv.getX(i), uv.getY(i)], i * 2);
    const influences = vertexInfluences(position.getX(i), position.getY(i));
    influences.forEach(([joint, weight], slot) => {
        joints[i * 4 + slot] = joint;
        weights[i * 4 + slot] = weight;
    });
}
const indices = new Uint16Array(sourceIndex.count);
for (let i = 0; i < sourceIndex.count; i++) indices[i] = sourceIndex.getX(i);

const worldMatrices = BONES.map(() => new THREE.Matrix4());
for (let i = 0; i < BONES.length; i++) {
    const bone = BONES[i];
    const local = new THREE.Matrix4().makeTranslation(...bone.translation);
    if (bone.parent) {
        worldMatrices[i].multiplyMatrices(worldMatrices[BONE_INDEX.get(bone.parent)], local);
    } else {
        worldMatrices[i].copy(local);
    }
}
const inverseBindMatrices = new Float32Array(BONES.length * 16);
worldMatrices.forEach((matrix, index) => {
    inverseBindMatrices.set(matrix.clone().invert().toArray(), index * 16);
});

const chunks = [];
const bufferViews = [];
const accessors = [];
let byteLength = 0;
const align4 = (value) => (value + 3) & ~3;
const addChunk = (array, target) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const offset = align4(byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    chunks.push({ offset, bytes: copy });
    const view = { buffer: 0, byteOffset: offset, byteLength: copy.byteLength };
    if (target) view.target = target;
    bufferViews.push(view);
    byteLength = offset + copy.byteLength;
    return bufferViews.length - 1;
};
const addAccessor = (array, componentType, type, count, options = {}) => {
    const bufferView = addChunk(array, options.target);
    const accessor = { bufferView, componentType, count, type };
    if (options.min) accessor.min = options.min;
    if (options.max) accessor.max = options.max;
    accessors.push(accessor);
    return accessors.length - 1;
};

const positionAccessor = addAccessor(positions, 5126, "VEC3", position.count, {
    target: 34962,
    min: [position.getX(0), position.getY(0), position.getZ(0)],
    max: [position.getX(0), position.getY(0), position.getZ(0)],
});
for (let i = 1; i < position.count; i++) {
    accessors[positionAccessor].min[0] = Math.min(accessors[positionAccessor].min[0], position.getX(i));
    accessors[positionAccessor].min[1] = Math.min(accessors[positionAccessor].min[1], position.getY(i));
    accessors[positionAccessor].min[2] = Math.min(accessors[positionAccessor].min[2], position.getZ(i));
    accessors[positionAccessor].max[0] = Math.max(accessors[positionAccessor].max[0], position.getX(i));
    accessors[positionAccessor].max[1] = Math.max(accessors[positionAccessor].max[1], position.getY(i));
    accessors[positionAccessor].max[2] = Math.max(accessors[positionAccessor].max[2], position.getZ(i));
}
const normalAccessor = addAccessor(normals, 5126, "VEC3", normal.count, { target: 34962 });
const uvAccessor = addAccessor(uvs, 5126, "VEC2", uv.count, { target: 34962 });
const jointAccessor = addAccessor(joints, 5123, "VEC4", position.count, { target: 34962 });
const weightAccessor = addAccessor(weights, 5126, "VEC4", position.count, { target: 34962 });
const indexAccessor = addAccessor(indices, 5123, "SCALAR", indices.length, {
    target: 34963,
    min: [Math.min(...indices)],
    max: [Math.max(...indices)],
});
const inverseBindAccessor = addAccessor(inverseBindMatrices, 5126, "MAT4", BONES.length);

const sourceImage = source.json.images?.[0];
const sourceImageView = source.json.bufferViews?.[sourceImage?.bufferView];
if (!sourceImage || !sourceImageView) throw new Error("Gate Warden texture image is missing.");
const imageStart = sourceImageView.byteOffset ?? 0;
const imageBytes = source.bin.subarray(imageStart, imageStart + sourceImageView.byteLength);
const imageBufferView = addChunk(imageBytes);

const nodes = [
    { name: "GateWarden_Mesh", mesh: 0, skin: 0 },
    ...BONES.map((bone) => ({ name: bone.name, translation: bone.translation })),
];
for (let i = 0; i < BONES.length; i++) {
    const children = BONES
        .map((candidate, childIndex) => candidate.parent === BONES[i].name ? childIndex + 1 : -1)
        .filter((childIndex) => childIndex >= 0);
    if (children.length) nodes[i + 1].children = children;
}

const animations = [];
for (const clip of CLIPS) {
    const timeArray = new Float32Array(clip.times);
    const input = addAccessor(timeArray, 5126, "SCALAR", timeArray.length, {
        min: [clip.times[0]],
        max: [clip.times.at(-1)],
    });
    const samplers = [];
    const channels = [];
    for (const [boneName, path, values] of clip.tracks) {
        const itemSize = path === "rotation" ? 4 : 3;
        const flatValues = Array.isArray(values[0]) ? values.flat() : values;
        const valueArray = new Float32Array(flatValues);
        if (valueArray.length !== clip.times.length * itemSize) {
            throw new Error(`${clip.name}/${boneName}/${path} has the wrong keyframe count.`);
        }
        const output = addAccessor(valueArray, 5126, path === "rotation" ? "VEC4" : "VEC3", clip.times.length);
        samplers.push({ input, output, interpolation: "LINEAR" });
        channels.push({
            sampler: samplers.length - 1,
            target: { node: BONE_INDEX.get(boneName) + 1, path },
        });
    }
    animations.push({ name: clip.name, samplers, channels });
}

const binary = new Uint8Array(align4(byteLength));
for (const chunk of chunks) binary.set(chunk.bytes, chunk.offset);
const gltf = {
    asset: { version: "2.0", generator: "Shinobi Journey Gate Warden Auto-Rig v1" },
    extensionsUsed: ["EXT_texture_webp"],
    scene: 0,
    scenes: [{ name: "Gate Warden Rig", nodes: [0, 1] }],
    nodes,
    meshes: [{
        name: "GateWarden_SkinnedMesh",
        primitives: [{
            attributes: {
                POSITION: positionAccessor,
                NORMAL: normalAccessor,
                TEXCOORD_0: uvAccessor,
                JOINTS_0: jointAccessor,
                WEIGHTS_0: weightAccessor,
            },
            indices: indexAccessor,
            material: 0,
        }],
    }],
    skins: [{
        name: "GateWarden_Armature",
        inverseBindMatrices: inverseBindAccessor,
        skeleton: 1,
        joints: BONES.map((_, index) => index + 1),
    }],
    animations,
    materials: source.json.materials,
    samplers: source.json.samplers,
    textures: source.json.textures,
    images: [{ name: sourceImage.name ?? "GateWarden_Albedo", mimeType: sourceImage.mimeType, bufferView: imageBufferView }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
};

const encoder = new TextEncoder();
const jsonBytes = encoder.encode(JSON.stringify(gltf));
const paddedJsonLength = align4(jsonBytes.byteLength);
const paddedBinLength = align4(binary.byteLength);
const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
const output = new Uint8Array(totalLength);
const outputView = new DataView(output.buffer);
outputView.setUint32(0, 0x46546c67, true);
outputView.setUint32(4, 2, true);
outputView.setUint32(8, totalLength, true);
outputView.setUint32(12, paddedJsonLength, true);
outputView.setUint32(16, 0x4e4f534a, true);
output.fill(0x20, 20, 20 + paddedJsonLength);
output.set(jsonBytes, 20);
const binHeader = 20 + paddedJsonLength;
outputView.setUint32(binHeader, paddedBinLength, true);
outputView.setUint32(binHeader + 4, 0x004e4942, true);
output.set(binary, binHeader + 8);

await mkdir(new URL("../tmp/", import.meta.url), { recursive: true });
await writeFile(AUTHORING_URL, output);
const meshoptArgs = [
    "--yes",
    "@gltf-transform/cli@4.4.2",
    "meshopt",
    fileURLToPath(AUTHORING_URL),
    fileURLToPath(OPTIMIZED_URL),
    "--level",
    "medium",
];
if (process.platform === "win32") {
    const npxCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
    await execFile(process.execPath, [npxCli, ...meshoptArgs]);
} else {
    await execFile("npx", meshoptArgs);
}
const optimized = await readFile(OPTIMIZED_URL);
await writeFile(OUTPUT_URL, optimized);
await Promise.all([unlink(AUTHORING_URL), unlink(OPTIMIZED_URL)]);
console.log(JSON.stringify({
    output: fileURLToPath(OUTPUT_URL),
    bytes: optimized.byteLength,
    vertices: position.count,
    triangles: indices.length / 3,
    bones: BONES.length,
    clips: CLIPS.map((clip) => ({ name: clip.name, duration: clip.times.at(-1), tracks: clip.tracks.length })),
}, null, 2));
