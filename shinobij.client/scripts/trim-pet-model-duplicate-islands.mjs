import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const clientRoot = resolve(import.meta.dirname, "..");
const rosterRoot = resolve(clientRoot, "public/pet-models/roster");
const repairs = {
    "legendary-22": {
        expectedSha256: "A6D35E64B92946F1CF516497A1F21C4F8AD117A8B7305908FD2F8AEF06F90DDE",
        repairedSha256: "DEE79A921E02596743CB8A538130948CE8C2FE02F04AAAEB82048AEE7381065C",
        duplicateRatio: [0.10, 0.11],
    },
    "legendary-26": {
        expectedSha256: "404FEC7070419861E7997304A30B8613CAF89B2D11689F07234200E06F0A1DA4",
        repairedSha256: "264183F61EF39CB4665094D5DD1CD0C56BA0AC51B4ED768B438B8F645079726F",
        duplicateRatio: [0.13, 0.15],
    },
};

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function parseGlb(file, id) {
    invariant(file.subarray(0, 4).toString("ascii") === "glTF" && file.readUInt32LE(4) === 2, `${id}: expected GLB v2`);
    const jsonLength = file.readUInt32LE(12);
    invariant(file.readUInt32LE(16) === 0x4e4f534a, `${id}: JSON chunk missing`);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    const binHeader = 20 + jsonLength;
    invariant(file.readUInt32LE(binHeader + 4) === 0x004e4942, `${id}: BIN chunk missing`);
    const binLength = file.readUInt32LE(binHeader);
    const binOffset = binHeader + 8;
    return { json, bin: file.subarray(binOffset, binOffset + binLength) };
}

function unionFind(size) {
    const parent = Int32Array.from({ length: size }, (_, index) => index);
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
        const rootLeft = find(left);
        const rootRight = find(right);
        if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
    };
    return { find, union };
}

function accessorLayout(json, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    invariant((view.buffer ?? 0) === 0, "only the primary BIN buffer is supported");
    return { accessor, view, start: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) };
}

function repairedIndices(json, bin, id, expectedRatio) {
    const primitive = json.meshes?.[0]?.primitives?.[0];
    invariant(json.meshes?.length === 1 && json.meshes[0].primitives?.length === 1 && primitive, `${id}: expected one primitive`);
    const positions = accessorLayout(json, primitive.attributes.POSITION);
    const indices = accessorLayout(json, primitive.indices);
    invariant(positions.accessor.componentType === 5126 && positions.accessor.type === "VEC3", `${id}: unexpected position format`);
    invariant(indices.accessor.componentType === 5123 && indices.accessor.type === "SCALAR", `${id}: unexpected index format`);
    const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const positionValue = (index, axis) => binView.getFloat32(positions.start + index * 12 + axis * 4, true);
    const indexValue = (offset) => binView.getUint16(indices.start + offset * 2, true);
    const sets = unionFind(positions.accessor.count);
    const coincident = new Map();
    for (let index = 0; index < positions.accessor.count; index += 1) {
        const key = `${Math.round(positionValue(index, 0) * 100_000)},${Math.round(positionValue(index, 1) * 100_000)},${Math.round(positionValue(index, 2) * 100_000)}`;
        const previous = coincident.get(key);
        if (previous === undefined) coincident.set(key, index);
        else sets.union(previous, index);
    }
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        const a = indexValue(offset);
        const b = indexValue(offset + 1);
        const c = indexValue(offset + 2);
        sets.union(a, b);
        sets.union(b, c);
    }
    const components = new Map();
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        const root = sets.find(indexValue(offset));
        components.set(root, (components.get(root) ?? 0) + 1);
    }
    const sorted = [...components.entries()].sort((left, right) => right[1] - left[1]);
    invariant(sorted.length >= 2, `${id}: expected a detached duplicate island`);
    const totalTriangles = indices.accessor.count / 3;
    const [duplicateRoot, duplicateTriangles] = sorted[1];
    const duplicateRatio = duplicateTriangles / totalTriangles;
    invariant(duplicateRatio >= expectedRatio[0] && duplicateRatio <= expectedRatio[1], `${id}: second island ratio ${duplicateRatio.toFixed(4)} is outside the reviewed range`);
    const kept = [];
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        if (sets.find(indexValue(offset)) === duplicateRoot) continue;
        kept.push(indexValue(offset), indexValue(offset + 1), indexValue(offset + 2));
    }
    const bytes = Buffer.allocUnsafe(kept.length * 2);
    for (let offset = 0; offset < kept.length; offset += 1) bytes.writeUInt16LE(kept[offset], offset * 2);
    return { bytes, indexAccessor: indices.accessor, indexView: indices.view, removedTriangles: duplicateTriangles, keptTriangles: kept.length / 3, duplicateRatio };
}

function packGlb(json, bin) {
    const jsonRaw = Buffer.from(JSON.stringify(json));
    const jsonPadding = (4 - jsonRaw.length % 4) % 4;
    const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPadding, 0x20)]);
    const binPadding = (4 - bin.length % 4) % 4;
    const binChunk = Buffer.concat([bin, Buffer.alloc(binPadding)]);
    const output = Buffer.allocUnsafe(12 + 8 + jsonChunk.length + 8 + binChunk.length);
    output.write("glTF", 0, "ascii");
    output.writeUInt32LE(2, 4);
    output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(jsonChunk.length, 12);
    output.writeUInt32LE(0x4e4f534a, 16);
    jsonChunk.copy(output, 20);
    const binHeader = 20 + jsonChunk.length;
    output.writeUInt32LE(binChunk.length, binHeader);
    output.writeUInt32LE(0x004e4942, binHeader + 4);
    binChunk.copy(output, binHeader + 8);
    return output;
}

async function repair(id, config) {
    const path = resolve(rosterRoot, `${id}.glb`);
    const file = await readFile(path);
    const currentHash = createHash("sha256").update(file).digest("hex").toUpperCase();
    if (currentHash === config.repairedSha256) return { id, status: "already repaired", sha256: currentHash };
    invariant(currentHash === config.expectedSha256, `${id}: binary changed since the reviewed repair plan`);
    const { json, bin } = parseGlb(file, id);
    const repair = repairedIndices(json, bin, id, config.duplicateRatio);
    const oldStart = repair.indexView.byteOffset ?? 0;
    const oldLength = repair.indexView.byteLength;
    const oldEnd = oldStart + oldLength;
    const paddedLength = repair.bytes.length + (4 - repair.bytes.length % 4) % 4;
    const replacement = Buffer.concat([repair.bytes, Buffer.alloc(paddedLength - repair.bytes.length)]);
    const newBin = Buffer.concat([bin.subarray(0, oldStart), replacement, bin.subarray(oldEnd)]);
    const delta = replacement.length - oldLength;
    repair.indexView.byteLength = repair.bytes.length;
    repair.indexAccessor.count = repair.bytes.length / 2;
    repair.indexAccessor.name = `${id.replace(/[^a-z0-9]/giu, "_")}_ReviewedIndices`;
    for (const view of json.bufferViews) {
        if (view === repair.indexView) continue;
        if ((view.byteOffset ?? 0) >= oldEnd) view.byteOffset = (view.byteOffset ?? 0) + delta;
    }
    json.buffers[0].byteLength = newBin.length;
    const output = packGlb(json, newBin);
    await writeFile(path, output);
    const sha256 = createHash("sha256").update(output).digest("hex").toUpperCase();
    return {
        id,
        bytes: output.length,
        sha256,
        triangles: repair.keptTriangles,
        removedTriangles: repair.removedTriangles,
        removedRatio: Number(repair.duplicateRatio.toFixed(4)),
    };
}

const results = [];
for (const [id, config] of Object.entries(repairs)) results.push(await repair(id, config));
console.log(JSON.stringify(results, null, 2));
