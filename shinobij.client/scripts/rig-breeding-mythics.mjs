import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as THREE from "three";

const execFile = promisify(execFileCallback);
const align4 = (value) => (value + 3) & ~3;
const PETS = Object.freeze([
    { id: "mythic-10", profile: "avian", pruneDetached: true },
    { id: "mythic-11", profile: "serpentine", pruneDetached: true },
    { id: "mythic-12", profile: "quadruped", pruneDetached: true },
    { id: "mythic-13", profile: "quadruped" },
    { id: "mythic-14", profile: "heavy", pruneDetached: true },
]);

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function parseGlb(file, id) {
    invariant(file.readUInt32LE(0) === 0x46546c67, `${id}: missing GLB magic`);
    invariant(file.readUInt32LE(4) === 2, `${id}: expected glTF 2.0`);
    const jsonLength = file.readUInt32LE(12);
    invariant(file.readUInt32LE(16) === 0x4e4f534a, `${id}: JSON chunk missing`);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    const binHeader = 20 + jsonLength;
    invariant(file.readUInt32LE(binHeader + 4) === 0x004e4942, `${id}: BIN chunk missing`);
    const binLength = file.readUInt32LE(binHeader);
    return { json, bin: file.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function positionReader(source, accessorIndex, id) {
    const accessor = source.json.accessors?.[accessorIndex];
    const view = source.json.bufferViews?.[accessor?.bufferView];
    invariant(accessor?.componentType === 5126 && accessor.type === "VEC3", `${id}: positions must be float VEC3`);
    invariant(view && (view.buffer ?? 0) === 0 && !view.extensions, `${id}: source geometry must be uncompressed`);
    const stride = view.byteStride ?? 12;
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const data = new DataView(source.bin.buffer, source.bin.byteOffset, source.bin.byteLength);
    return {
        count: accessor.count,
        value(index, axis) {
            return data.getFloat32(offset + index * stride + axis * 4, true);
        },
    };
}

function accessorReader(source, accessorIndex, id, expectedType) {
    const accessor = source.json.accessors?.[accessorIndex];
    const view = source.json.bufferViews?.[accessor?.bufferView];
    const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
    const methods = { 5121: "getUint8", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" };
    invariant(accessor && accessor.type === expectedType, `${id}: expected ${expectedType} accessor`);
    invariant(view && (view.buffer ?? 0) === 0 && !view.extensions, `${id}: source accessor must be uncompressed`);
    const width = widths[accessor.type];
    const componentBytes = bytes[accessor.componentType];
    const method = methods[accessor.componentType];
    invariant(width && componentBytes && method, `${id}: unsupported accessor encoding`);
    const stride = view.byteStride ?? width * componentBytes;
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const data = new DataView(source.bin.buffer, source.bin.byteOffset, source.bin.byteLength);
    return {
        count: accessor.count,
        value(index, component = 0) {
            return data[method](offset + index * stride + component * componentBytes, componentBytes > 1);
        },
    };
}

function dominantGeometry(source, primitive, id) {
    const position = accessorReader(source, primitive.attributes.POSITION, id, "VEC3");
    const normal = accessorReader(source, primitive.attributes.NORMAL, id, "VEC3");
    const uv = accessorReader(source, primitive.attributes.TEXCOORD_0, id, "VEC2");
    const indices = accessorReader(source, primitive.indices, id, "SCALAR");
    const parent = Array.from({ length: position.count }, (_, index) => index);
    const find = (value) => {
        let root = value;
        while (parent[root] !== root) root = parent[root];
        while (parent[value] !== value) {
            const next = parent[value];
            parent[value] = root;
            value = next;
        }
        return root;
    };
    const union = (left, right) => {
        const a = find(left);
        const b = find(right);
        if (a !== b) parent[b] = a;
    };
    const coincident = new Map();
    for (let vertex = 0; vertex < position.count; vertex += 1) {
        const key = `${Math.round(position.value(vertex, 0) * 100_000)},${Math.round(position.value(vertex, 1) * 100_000)},${Math.round(position.value(vertex, 2) * 100_000)}`;
        const prior = coincident.get(key);
        if (prior === undefined) coincident.set(key, vertex);
        else union(prior, vertex);
    }
    for (let offset = 0; offset < indices.count; offset += 3) {
        const a = indices.value(offset);
        const b = indices.value(offset + 1);
        const c = indices.value(offset + 2);
        union(a, b);
        union(b, c);
    }
    const triangles = new Map();
    for (let offset = 0; offset < indices.count; offset += 3) {
        const root = find(indices.value(offset));
        triangles.set(root, (triangles.get(root) ?? 0) + 1);
    }
    const dominant = [...triangles.entries()].sort((a, b) => b[1] - a[1])[0];
    invariant(dominant, `${id}: no indexed triangles found`);
    const remap = new Map();
    const positionValues = [];
    const normalValues = [];
    const uvValues = [];
    const indexValues = [];
    for (let offset = 0; offset < indices.count; offset += 3) {
        if (find(indices.value(offset)) !== dominant[0]) continue;
        for (let corner = 0; corner < 3; corner += 1) {
            const sourceVertex = indices.value(offset + corner);
            let targetVertex = remap.get(sourceVertex);
            if (targetVertex === undefined) {
                targetVertex = remap.size;
                remap.set(sourceVertex, targetVertex);
                for (let axis = 0; axis < 3; axis += 1) positionValues.push(position.value(sourceVertex, axis));
                for (let axis = 0; axis < 3; axis += 1) normalValues.push(normal.value(sourceVertex, axis));
                for (let axis = 0; axis < 2; axis += 1) uvValues.push(uv.value(sourceVertex, axis));
            }
            indexValues.push(targetVertex);
        }
    }
    const positions = new Float32Array(positionValues);
    return {
        pruned: true,
        count: remap.size,
        positions,
        normals: new Float32Array(normalValues),
        uvs: new Float32Array(uvValues),
        indices: remap.size <= 65_535 ? new Uint16Array(indexValues) : new Uint32Array(indexValues),
        removedTriangles: indices.count / 3 - dominant[1],
        value(index, axis) { return positions[index * 3 + axis]; },
    };
}

function topology(profile) {
    const common = [
        ["root", null], ["pelvis", "root"], ["spine", "pelvis"], ["chest", "spine"],
        ["neck", "chest"], ["head", "neck"],
    ];
    const tail = [["tail_1", "pelvis"], ["tail_2", "tail_1"], ["tail_3", "tail_2"]];
    if (profile === "avian") return [
        ...common,
        ["wing_upper.L", "chest"], ["wing_mid.L", "wing_upper.L"], ["wing_tip.L", "wing_mid.L"],
        ["wing_upper.R", "chest"], ["wing_mid.R", "wing_upper.R"], ["wing_tip.R", "wing_mid.R"],
        ...tail,
        ["thigh.L", "pelvis"], ["shin.L", "thigh.L"], ["foot.L", "shin.L"],
        ["thigh.R", "pelvis"], ["shin.R", "thigh.R"], ["foot.R", "shin.R"],
    ];
    if (profile === "heavy") return [
        ...common,
        ["upper_arm.L", "chest"], ["forearm.L", "upper_arm.L"], ["hand.L", "forearm.L"],
        ["upper_arm.R", "chest"], ["forearm.R", "upper_arm.R"], ["hand.R", "forearm.R"],
        ...tail,
        ["thigh.L", "pelvis"], ["shin.L", "thigh.L"], ["foot.L", "shin.L"],
        ["thigh.R", "pelvis"], ["shin.R", "thigh.R"], ["foot.R", "shin.R"],
    ];
    return [
        ...common,
        ["front_upper.L", "chest"], ["front_lower.L", "front_upper.L"], ["front_paw.L", "front_lower.L"],
        ["front_upper.R", "chest"], ["front_lower.R", "front_upper.R"], ["front_paw.R", "front_lower.R"],
        ...tail,
        ["hind_upper.L", "pelvis"], ["hind_lower.L", "hind_upper.L"], ["hind_paw.L", "hind_lower.L"],
        ["hind_upper.R", "pelvis"], ["hind_lower.R", "hind_upper.R"], ["hind_paw.R", "hind_lower.R"],
    ];
}

function semanticTargets(profile, bounds) {
    const [minX, minY, minZ] = bounds.min;
    const [maxX, maxY, maxZ] = bounds.max;
    const w = maxX - minX;
    const h = maxY - minY;
    const d = maxZ - minZ;
    const x = (minX + maxX) / 2;
    const y = (minY + maxY) / 2;
    const z = (minZ + maxZ) / 2;
    const p = (px, py, pz) => [x + px * w, y + py * h, z + pz * d];
    if (profile === "avian") return {
        root: p(0, -0.48, 0), pelvis: p(0, -0.12, -0.03), spine: p(0, 0.04, 0),
        chest: p(0, 0.19, 0.02), neck: p(0, 0.34, 0.04), head: p(0, 0.46, 0.06),
        "wing_upper.L": p(-0.16, 0.18, 0), "wing_mid.L": p(-0.34, 0.12, -0.01), "wing_tip.L": p(-0.49, 0.02, -0.03),
        "wing_upper.R": p(0.16, 0.18, 0), "wing_mid.R": p(0.34, 0.12, -0.01), "wing_tip.R": p(0.49, 0.02, -0.03),
        tail_1: p(0, -0.19, -0.13), tail_2: p(0, -0.32, -0.18), tail_3: p(0, -0.45, -0.22),
        "thigh.L": p(-0.12, -0.2, 0.02), "shin.L": p(-0.12, -0.34, 0.03), "foot.L": p(-0.12, -0.47, 0.07),
        "thigh.R": p(0.12, -0.2, 0.02), "shin.R": p(0.12, -0.34, 0.03), "foot.R": p(0.12, -0.47, 0.07),
    };
    if (profile === "heavy") return {
        root: p(0, -0.49, 0), pelvis: p(0, -0.18, 0), spine: p(0, -0.02, 0),
        chest: p(0, 0.18, 0), neck: p(0, 0.32, 0.02), head: p(0, 0.44, 0.04),
        "upper_arm.L": p(-0.2, 0.16, 0), "forearm.L": p(-0.35, 0, 0.02), "hand.L": p(-0.43, -0.18, 0.06),
        "upper_arm.R": p(0.2, 0.16, 0), "forearm.R": p(0.35, 0, 0.02), "hand.R": p(0.43, -0.18, 0.06),
        tail_1: p(0, -0.14, -0.18), tail_2: p(0, -0.18, -0.34), tail_3: p(0, -0.22, -0.48),
        "thigh.L": p(-0.14, -0.25, 0), "shin.L": p(-0.14, -0.37, 0), "foot.L": p(-0.14, -0.48, 0.08),
        "thigh.R": p(0.14, -0.25, 0), "shin.R": p(0.14, -0.37, 0), "foot.R": p(0.14, -0.48, 0.08),
    };
    const serpentine = profile === "serpentine";
    return {
        root: p(0, -0.47, 0), pelvis: p(0, serpentine ? -0.12 : 0, -0.2),
        spine: p(0, serpentine ? 0 : 0.04, -0.03), chest: p(0, serpentine ? 0.12 : 0.08, 0.18),
        neck: p(0, serpentine ? 0.25 : 0.18, 0.33), head: p(0, serpentine ? 0.38 : 0.28, 0.45),
        "front_upper.L": p(-0.16, serpentine ? 0.08 : 0, 0.2), "front_lower.L": p(-0.2, serpentine ? 0 : -0.25, 0.22), "front_paw.L": p(-0.2, serpentine ? -0.06 : -0.47, 0.25),
        "front_upper.R": p(0.16, serpentine ? 0.08 : 0, 0.2), "front_lower.R": p(0.2, serpentine ? 0 : -0.25, 0.22), "front_paw.R": p(0.2, serpentine ? -0.06 : -0.47, 0.25),
        tail_1: p(0, -0.1, -0.32), tail_2: p(0, -0.18, -0.43), tail_3: p(0, -0.27, -0.5),
        "hind_upper.L": p(-0.16, serpentine ? -0.1 : -0.02, -0.2), "hind_lower.L": p(-0.18, serpentine ? -0.16 : -0.27, -0.2), "hind_paw.L": p(-0.18, serpentine ? -0.2 : -0.47, -0.18),
        "hind_upper.R": p(0.16, serpentine ? -0.1 : -0.02, -0.2), "hind_lower.R": p(0.18, serpentine ? -0.16 : -0.27, -0.2), "hind_paw.R": p(0.18, serpentine ? -0.2 : -0.47, -0.18),
    };
}

function quaternion(x = 0, y = 0, z = 0) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ")).toArray();
}

function animationPlan(profile, rootBind, worldToLocalDirection) {
    const avian = profile === "avian";
    const heavy = profile === "heavy";
    const foreL = avian ? "wing_upper.L" : heavy ? "upper_arm.L" : "front_upper.L";
    const foreR = avian ? "wing_upper.R" : heavy ? "upper_arm.R" : "front_upper.R";
    const hindL = heavy || avian ? "thigh.L" : "hind_upper.L";
    const hindR = heavy || avian ? "thigh.R" : "hind_upper.R";
    const translation = (worldX = 0, worldY = 0, worldZ = 0) => {
        const delta = worldToLocalDirection(new THREE.Vector3(worldX, worldY, worldZ));
        return [rootBind[0] + delta.x, rootBind[1] + delta.y, rootBind[2] + delta.z];
    };
    const r = (values) => values.flatMap((value) => quaternion(...value));
    const t = (...values) => values.map((value) => translation(...value));
    return [
        { name: "idle", times: [0, 0.6, 1.2, 1.8, 2.4], tracks: [
            ["root", "translation", t([0, 0, 0], [0, 0.018, 0], [0, 0, 0], [0, 0.014, 0], [0, 0, 0])],
            ["chest", "rotation", r([[0, 0, 0], [0.025, 0.012, 0.018], [0, 0, 0], [-0.018, -0.012, -0.018], [0, 0, 0]])],
            ["head", "rotation", r([[0, 0, 0], [-0.02, -0.025, 0], [0, 0, 0], [0.015, 0.025, 0], [0, 0, 0]])],
            ["tail_1", "rotation", r([[0, 0, -0.025], [0, 0.05, 0], [0, 0, 0.025], [0, -0.05, 0], [0, 0, -0.025]])],
        ] },
        { name: "idle_2", times: [0, 0.7, 1.4, 2.1, 2.8], tracks: [
            ["root", "translation", t([0, 0, 0], [0, 0.012, 0], [0, 0, 0], [0, 0.012, 0], [0, 0, 0])],
            ["neck", "rotation", r([[0, 0, 0], [-0.035, 0.12, 0.025], [0.02, 0, 0], [-0.035, -0.12, -0.025], [0, 0, 0]])],
            ["head", "rotation", r([[0, 0, 0], [0.02, 0.16, 0.04], [-0.025, 0, 0], [0.02, -0.16, -0.04], [0, 0, 0]])],
            ["tail_2", "rotation", r([[0, 0, 0], [0.02, 0.1, 0], [0, 0, 0], [-0.02, -0.1, 0], [0, 0, 0]])],
        ] },
        { name: "walk", times: [0, 0.3, 0.6, 0.9, 1.2], tracks: [
            ["root", "translation", t([0, 0, 0], [0, 0.035, 0.015], [0, 0, 0.03], [0, 0.035, 0.015], [0, 0, 0])],
            [foreL, "rotation", r([[-0.28, 0, 0.04], [0, 0, 0], [0.28, 0, -0.04], [0, 0, 0], [-0.28, 0, 0.04]])],
            [foreR, "rotation", r([[0.28, 0, -0.04], [0, 0, 0], [-0.28, 0, 0.04], [0, 0, 0], [0.28, 0, -0.04]])],
            [hindL, "rotation", r([[0.24, 0, 0], [0, 0, 0], [-0.24, 0, 0], [0, 0, 0], [0.24, 0, 0]])],
            [hindR, "rotation", r([[-0.24, 0, 0], [0, 0, 0], [0.24, 0, 0], [0, 0, 0], [-0.24, 0, 0]])],
            ["tail_1", "rotation", r([[0, -0.08, 0], [0, 0, 0], [0, 0.08, 0], [0, 0, 0], [0, -0.08, 0]])],
        ] },
        { name: "gallop", times: [0, 0.225, 0.45, 0.675, 0.9], tracks: [
            ["root", "translation", t([0, 0, 0], [0, 0.085, 0.035], [0, 0.015, 0.07], [0, 0.085, 0.035], [0, 0, 0])],
            ["spine", "rotation", r([[0.08, 0, 0], [-0.08, 0, 0], [0.08, 0, 0], [-0.08, 0, 0], [0.08, 0, 0]])],
            [foreL, "rotation", r([[-0.52, 0, 0], [0.12, 0, 0], [0.52, 0, 0], [0.12, 0, 0], [-0.52, 0, 0]])],
            [foreR, "rotation", r([[0.52, 0, 0], [0.12, 0, 0], [-0.52, 0, 0], [0.12, 0, 0], [0.52, 0, 0]])],
            [hindL, "rotation", r([[0.45, 0, 0], [-0.08, 0, 0], [-0.45, 0, 0], [-0.08, 0, 0], [0.45, 0, 0]])],
            [hindR, "rotation", r([[-0.45, 0, 0], [-0.08, 0, 0], [0.45, 0, 0], [-0.08, 0, 0], [-0.45, 0, 0]])],
        ] },
        { name: "gallop_jump", times: [0, 0.28, 0.58, 0.88, 1.2], tracks: [
            ["root", "translation", t([0, 0, 0], [0, 0.18, 0.04], [0, 0.34, 0.1], [0, 0.16, 0.16], [0, 0, 0.2])],
            ["chest", "rotation", r([[0, 0, 0], [-0.12, 0, 0], [-0.2, 0, 0], [0.08, 0, 0], [0, 0, 0]])],
            [foreL, "rotation", r([[0, 0, 0], [-0.48, 0, 0.08], [-0.68, 0, 0.12], [0.2, 0, 0], [0, 0, 0]])],
            [foreR, "rotation", r([[0, 0, 0], [-0.48, 0, -0.08], [-0.68, 0, -0.12], [0.2, 0, 0], [0, 0, 0]])],
            [hindL, "rotation", r([[0, 0, 0], [0.4, 0, 0], [0.6, 0, 0], [-0.15, 0, 0], [0, 0, 0]])],
            [hindR, "rotation", r([[0, 0, 0], [0.4, 0, 0], [0.6, 0, 0], [-0.15, 0, 0], [0, 0, 0]])],
        ] },
        { name: "attack", times: [0, 0.2, 0.38, 0.58, 0.82], tracks: [
            ["root", "translation", t([0, 0, 0], [0, -0.025, -0.045], [0, 0.035, 0.16], [0, 0.015, 0.08], [0, 0, 0])],
            ["spine", "rotation", r([[0, 0, 0], [-0.18, 0, 0], [0.34, 0, 0], [0.12, 0, 0], [0, 0, 0]])],
            ["head", "rotation", r([[0, 0, 0], [0.14, 0, 0], [-0.24, 0, 0], [0.08, 0, 0], [0, 0, 0]])],
            [foreL, "rotation", r([[0, 0, 0], [-0.5, 0, 0.14], [0.72, 0, 0.04], [0.2, 0, 0], [0, 0, 0]])],
            [foreR, "rotation", r([[0, 0, 0], [-0.5, 0, -0.14], [0.72, 0, -0.04], [0.2, 0, 0], [0, 0, 0]])],
        ] },
        { name: "idle_hitreact1", times: [0, 0.09, 0.24, 0.48], tracks: [
            ["root", "translation", t([0, 0, 0], [-0.025, -0.035, -0.1], [0.012, -0.012, -0.025], [0, 0, 0])],
            ["spine", "rotation", r([[0, 0, 0], [-0.22, 0, 0.18], [0.1, 0, -0.08], [0, 0, 0]])],
            ["head", "rotation", r([[0, 0, 0], [0.24, 0, -0.24], [-0.08, 0, 0.1], [0, 0, 0]])],
        ] },
        { name: "death", times: [0, 0.3, 0.68, 1.05, 1.45], tracks: [
            ["root", "translation", t([0, 0, 0], [0, -0.05, -0.02], [0, -0.18, -0.04], [0, -0.31, -0.05], [0, -0.34, -0.05])],
            ["pelvis", "rotation", r([[0, 0, 0], [0.04, 0, 0.08], [0.1, 0, 0.42], [0.14, 0, 0.9], [0.14, 0, 1.18]])],
            ["chest", "rotation", r([[0, 0, 0], [-0.08, 0, 0], [-0.2, 0, 0], [-0.34, 0, 0], [-0.38, 0, 0]])],
            ["head", "rotation", r([[0, 0, 0], [0.08, 0, 0], [0.24, 0, 0], [0.34, 0, 0], [0.4, 0, 0]])],
        ] },
    ];
}

function encodeGlb(json, binary) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = align4(jsonBytes.byteLength);
    const binLength = align4(binary.byteLength);
    const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
    const view = new DataView(output.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, output.byteLength, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    output.fill(0x20, 20, 20 + jsonLength);
    output.set(jsonBytes, 20);
    const binHeader = 20 + jsonLength;
    view.setUint32(binHeader, binLength, true);
    view.setUint32(binHeader + 4, 0x004e4942, true);
    output.set(binary, binHeader + 8);
    return output;
}

async function rigPet({ id, profile, pruneDetached = false }) {
    const sourcePath = new URL(`../public/pet-models/${id}.glb`, import.meta.url);
    const outputPath = new URL(`../public/pet-models/roster/${id}.glb`, import.meta.url);
    const tempRoot = new URL(`../.tmp/breeding-mythic-rigs/`, import.meta.url);
    const authoringPath = new URL(`${id}-authoring.glb`, tempRoot);
    const optimizedPath = new URL(`${id}-optimized.glb`, tempRoot);
    const source = parseGlb(await readFile(sourcePath), id);
    const json = structuredClone(source.json);
    const primitive = json.meshes?.[0]?.primitives?.[0];
    invariant(json.meshes?.length === 1 && json.meshes[0].primitives?.length === 1, `${id}: expected one mesh primitive`);
    const positions = pruneDetached
        ? dominantGeometry(source, primitive, id)
        : { ...positionReader(source, primitive.attributes?.POSITION, id), pruned: false, removedTriangles: 0 };
    const meshNodeIndex = json.nodes?.findIndex((node) => node.mesh === 0) ?? -1;
    invariant(meshNodeIndex >= 0, `${id}: mesh node missing`);

    const meshNode = json.nodes[meshNodeIndex];
    invariant(!meshNode.matrix, `${id}: matrix-authored mesh transform is unsupported`);
    const modelRotation = new THREE.Quaternion(...(meshNode.rotation ?? [0, 0, 0, 1])).normalize();
    const inverseModelRotation = modelRotation.clone().invert();
    const worldPositions = new Array(positions.count);
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let index = 0; index < positions.count; index += 1) {
        const point = new THREE.Vector3(positions.value(index, 0), positions.value(index, 1), positions.value(index, 2)).applyQuaternion(modelRotation);
        worldPositions[index] = point;
        for (let axis = 0; axis < 3; axis += 1) {
            bounds.min[axis] = Math.min(bounds.min[axis], point.getComponent(axis));
            bounds.max[axis] = Math.max(bounds.max[axis], point.getComponent(axis));
        }
    }

    const bones = topology(profile);
    invariant(bones.length === 21, `${id}: production combat rigs require 21 bones`);
    const boneIndex = new Map(bones.map(([name], index) => [name, index]));
    const targetsWorld = semanticTargets(profile, bounds);
    const targetsLocal = Object.fromEntries(Object.entries(targetsWorld).map(([name, point]) => [
        name,
        new THREE.Vector3(...point).applyQuaternion(inverseModelRotation).toArray(),
    ]));
    const translations = bones.map(([name, parent]) => {
        const target = targetsLocal[name];
        if (!parent) return target;
        const parentTarget = targetsLocal[parent];
        return target.map((value, axis) => value - parentTarget[axis]);
    });

    const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
    const joints = new Uint16Array(positions.count * 4);
    const weights = new Float32Array(positions.count * 4);
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const point = worldPositions[vertex];
        const ranked = bones.map(([name], index) => {
            const target = targetsWorld[name];
            const dx = (point.x - target[0]) / Math.max(size[0] * 0.22, 0.08);
            const dy = (point.y - target[1]) / Math.max(size[1] * 0.2, 0.08);
            const dz = (point.z - target[2]) / Math.max(size[2] * 0.22, 0.08);
            return [index, dx * dx + dy * dy + dz * dz];
        }).sort((a, b) => a[1] - b[1]).slice(0, 4);
        const strengths = ranked.map(([, distance]) => Math.exp(-Math.min(distance, 20) * 1.6) + 1e-6);
        const total = strengths.reduce((sum, value) => sum + value, 0);
        ranked.forEach(([joint], slot) => {
            joints[vertex * 4 + slot] = joint;
            weights[vertex * 4 + slot] = strengths[slot] / total;
        });
    }

    const chunks = [{ offset: 0, bytes: source.bin }];
    let byteLength = source.bin.byteLength;
    json.bufferViews ??= [];
    json.accessors ??= [];
    const addChunk = (array, target) => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        const offset = align4(byteLength);
        chunks.push({ offset, bytes });
        const view = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength };
        if (target) view.target = target;
        json.bufferViews.push(view);
        byteLength = offset + bytes.byteLength;
        return json.bufferViews.length - 1;
    };
    const addAccessor = (array, componentType, type, count, options = {}) => {
        const accessor = { bufferView: addChunk(array, options.target), componentType, count, type };
        if (options.min) accessor.min = options.min;
        if (options.max) accessor.max = options.max;
        json.accessors.push(accessor);
        return json.accessors.length - 1;
    };
    if (positions.pruned) {
        const minima = [Infinity, Infinity, Infinity];
        const maxima = [-Infinity, -Infinity, -Infinity];
        for (let index = 0; index < positions.count; index += 1) {
            for (let axis = 0; axis < 3; axis += 1) {
                const value = positions.value(index, axis);
                minima[axis] = Math.min(minima[axis], value);
                maxima[axis] = Math.max(maxima[axis], value);
            }
        }
        primitive.attributes.POSITION = addAccessor(positions.positions, 5126, "VEC3", positions.count, { target: 34962, min: minima, max: maxima });
        primitive.attributes.NORMAL = addAccessor(positions.normals, 5126, "VEC3", positions.count, { target: 34962 });
        primitive.attributes.TEXCOORD_0 = addAccessor(positions.uvs, 5126, "VEC2", positions.count, { target: 34962 });
        primitive.indices = addAccessor(
            positions.indices,
            positions.indices instanceof Uint16Array ? 5123 : 5125,
            "SCALAR",
            positions.indices.length,
            { target: 34963, min: [0], max: [positions.count - 1] },
        );
        delete primitive.attributes.TANGENT;
    }
    primitive.attributes.JOINTS_0 = addAccessor(joints, 5123, "VEC4", positions.count, { target: 34962 });
    primitive.attributes.WEIGHTS_0 = addAccessor(weights, 5126, "VEC4", positions.count, { target: 34962 });

    const localWorldMatrices = bones.map(() => new THREE.Matrix4());
    bones.forEach(([, parent], index) => {
        const local = new THREE.Matrix4().makeTranslation(...translations[index]);
        if (parent) localWorldMatrices[index].multiplyMatrices(localWorldMatrices[boneIndex.get(parent)], local);
        else localWorldMatrices[index].copy(local);
    });
    const inverseBinds = new Float32Array(bones.length * 16);
    localWorldMatrices.forEach((matrix, index) => inverseBinds.set(matrix.clone().invert().toArray(), index * 16));
    const inverseBindAccessor = addAccessor(inverseBinds, 5126, "MAT4", bones.length);

    const originalTransform = {
        ...(meshNode.translation ? { translation: meshNode.translation } : {}),
        ...(meshNode.rotation ? { rotation: meshNode.rotation } : {}),
        ...(meshNode.scale ? { scale: meshNode.scale } : {}),
    };
    delete meshNode.translation;
    delete meshNode.rotation;
    delete meshNode.scale;
    meshNode.skin = 0;
    meshNode.name = `${id}_SkinnedMesh`;
    const rootNodeIndex = json.nodes.length;
    const boneNodes = bones.map(([name], index) => ({ name, translation: translations[index] }));
    bones.forEach(([name], index) => {
        const children = bones.map(([, parent], child) => parent === name ? rootNodeIndex + child : -1).filter((child) => child >= 0);
        if (children.length) boneNodes[index].children = children;
    });
    json.nodes.push(...boneNodes);
    const groupNodeIndex = json.nodes.length;
    json.nodes.push({ name: `${id}_ProductionRig`, ...originalTransform, children: [meshNodeIndex, rootNodeIndex] });
    for (const scene of json.scenes ?? []) {
        scene.nodes = (scene.nodes ?? []).map((node) => node === meshNodeIndex ? groupNodeIndex : node);
        if (!scene.nodes.includes(groupNodeIndex)) scene.nodes.push(groupNodeIndex);
    }
    json.skins = [{
        name: `${id}_CombatArmature`,
        inverseBindMatrices: inverseBindAccessor,
        skeleton: rootNodeIndex,
        joints: bones.map((_, index) => rootNodeIndex + index),
    }];

    json.animations = [];
    const plan = animationPlan(profile, translations[0], (vector) => vector.applyQuaternion(inverseModelRotation));
    for (const clip of plan) {
        const times = new Float32Array(clip.times);
        const input = addAccessor(times, 5126, "SCALAR", times.length, { min: [clip.times[0]], max: [clip.times.at(-1)] });
        const samplers = [];
        const channels = [];
        for (const [boneName, path, values] of clip.tracks) {
            const flat = Array.isArray(values[0]) ? values.flat() : values;
            const width = path === "rotation" ? 4 : 3;
            invariant(flat.length === times.length * width, `${id}/${clip.name}/${boneName}: keyframe mismatch`);
            const output = addAccessor(new Float32Array(flat), 5126, path === "rotation" ? "VEC4" : "VEC3", times.length);
            samplers.push({ input, output, interpolation: "LINEAR" });
            channels.push({ sampler: samplers.length - 1, target: { node: rootNodeIndex + boneIndex.get(boneName), path } });
        }
        json.animations.push({ name: clip.name, samplers, channels });
    }

    json.asset = { ...json.asset, generator: "Shinobi Journey Breeding Mythic Auto-Rig v1" };
    json.buffers = [{ byteLength: align4(byteLength) }];
    const binary = new Uint8Array(align4(byteLength));
    for (const chunk of chunks) binary.set(chunk.bytes, chunk.offset);
    await mkdir(tempRoot, { recursive: true });
    await writeFile(authoringPath, encodeGlb(json, binary));

    const cliArgs = [
        "--yes", "@gltf-transform/cli@4.4.2", "optimize",
        fileURLToPath(authoringPath), fileURLToPath(optimizedPath),
        "--compress", "meshopt", "--texture-compress", "webp",
        "--texture-size", "2048", "--simplify", "false",
    ];
    if (process.platform === "win32") {
        const npxCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
        await execFile(process.execPath, [npxCli, ...cliArgs], { maxBuffer: 10 * 1024 * 1024 });
    } else {
        await execFile("npx", cliArgs, { maxBuffer: 10 * 1024 * 1024 });
    }
    const optimized = await readFile(optimizedPath);
    await writeFile(outputPath, optimized);
    await Promise.all([unlink(authoringPath), unlink(optimizedPath)]);
    return { id, profile, bytes: optimized.byteLength, vertices: positions.count, removedTriangles: positions.removedTriangles, bones: bones.length, clips: plan.map((clip) => clip.name) };
}

const requested = process.argv.slice(2).filter((value) => value.startsWith("mythic-"));
const selected = requested.length ? PETS.filter((pet) => requested.includes(pet.id)) : PETS;
invariant(selected.length > 0, "No breeding Mythic ids matched.");
const results = [];
for (const pet of selected) results.push(await rigPet(pet));
console.log(JSON.stringify(results, null, 2));
