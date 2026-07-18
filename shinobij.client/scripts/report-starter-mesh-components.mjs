import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const clientRoot = resolve(import.meta.dirname, "..");
const ids = process.argv.slice(2);
if (!ids.length) throw new Error("Pass one or more starter model ids.");
await MeshoptDecoder.ready;

function parseGlb(file) {
    const jsonLength = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    const binHeader = 20 + jsonLength;
    return { json, bin: file.subarray(binHeader + 8, binHeader + 8 + file.readUInt32LE(binHeader)) };
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

function decodedView(json, bin, viewIndex) {
    const view = json.bufferViews[viewIndex];
    const extension = view.extensions?.EXT_meshopt_compression;
    if (!extension) return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const source = bin.subarray(extension.byteOffset ?? 0, (extension.byteOffset ?? 0) + extension.byteLength);
    const output = new Uint8Array(extension.count * extension.byteStride);
    MeshoptDecoder.decodeGltfBuffer(output, extension.count, extension.byteStride, source, extension.mode, extension.filter);
    return output;
}

function report(json, bin, id) {
    const primitive = json.meshes[0].primitives[0];
    const positionAccessor = json.accessors[primitive.attributes.POSITION];
    const indexAccessor = json.accessors[primitive.indices];
    const positionBytes = decodedView(json, bin, positionAccessor.bufferView);
    const indexBytes = decodedView(json, bin, indexAccessor.bufferView);
    const positionView = new DataView(positionBytes.buffer, positionBytes.byteOffset, positionBytes.byteLength);
    const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
    const positionStride = json.bufferViews[positionAccessor.bufferView].byteStride ?? 8;
    const position = (index, axis) => positionView.getInt16((positionAccessor.byteOffset ?? 0) + index * positionStride + axis * 2, true) / 32767;
    const index = (offset) => indexView.getUint16((indexAccessor.byteOffset ?? 0) + offset * 2, true);
    const earthFloorRatio = Number(process.env.STARTER_EARTH_FLOOR_RATIO ?? 0.045);
    const floorCut = id.startsWith("starter-earth")
        ? positionAccessor.min[1] / 32767 + (positionAccessor.max[1] - positionAccessor.min[1]) / 32767 * earthFloorRatio
        : -Infinity;
    const triangleOffsets = [];
    for (let offset = 0; offset < indexAccessor.count; offset += 3) {
        if (position(index(offset), 1) <= floorCut && position(index(offset + 1), 1) <= floorCut && position(index(offset + 2), 1) <= floorCut) continue;
        triangleOffsets.push(offset);
    }
    const sets = unionFind(positionAccessor.count);
    const coincident = new Map();
    for (let vertex = 0; vertex < positionAccessor.count; vertex += 1) {
        const key = `${Math.round(position(vertex, 0) * 100_000)},${Math.round(position(vertex, 1) * 100_000)},${Math.round(position(vertex, 2) * 100_000)}`;
        const previous = coincident.get(key);
        if (previous === undefined) coincident.set(key, vertex);
        else sets.union(previous, vertex);
    }
    for (const offset of triangleOffsets) {
        sets.union(index(offset), index(offset + 1));
        sets.union(index(offset + 1), index(offset + 2));
    }
    const components = new Map();
    for (const offset of triangleOffsets) {
        const root = sets.find(index(offset));
        let component = components.get(root);
        if (!component) {
            component = { triangles: 0, vertices: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
            components.set(root, component);
        }
        component.triangles += 1;
        for (const vertex of [index(offset), index(offset + 1), index(offset + 2)]) component.vertices.add(vertex);
    }
    const totalTriangles = triangleOffsets.length;
    return [...components.entries()].map(([root, component]) => {
        for (const vertex of component.vertices) {
            for (let axis = 0; axis < 3; axis += 1) {
                component.min[axis] = Math.min(component.min[axis], position(vertex, axis));
                component.max[axis] = Math.max(component.max[axis], position(vertex, axis));
            }
        }
        const size = component.max.map((value, axis) => value - component.min[axis]);
        const center = component.max.map((value, axis) => (value + component.min[axis]) / 2);
        return {
            root,
            triangles: component.triangles,
            ratio: Number((component.triangles / totalTriangles).toFixed(4)),
            vertices: component.vertices.size,
            min: component.min.map((value) => Number(value.toFixed(4))),
            max: component.max.map((value) => Number(value.toFixed(4))),
            size: size.map((value) => Number(value.toFixed(4))),
            center: center.map((value) => Number(value.toFixed(4))),
            flatness: Number((Math.min(...size) / Math.max(...size)).toFixed(4)),
        };
    }).sort((left, right) => right.triangles - left.triangles);
}

for (const id of ids) {
    const file = await readFile(resolve(clientRoot, `public/pet-models/${id}.glb`));
    const { json, bin } = parseGlb(file);
    if (process.env.EXTRACT_STARTER_ATLAS) {
        const imageView = json.bufferViews[json.images[0].bufferView];
        await writeFile(resolve(clientRoot, `.tmp/pet-model-certification/${id}-atlas.webp`), bin.subarray(imageView.byteOffset ?? 0, (imageView.byteOffset ?? 0) + imageView.byteLength));
    }
    console.log(JSON.stringify({ id, components: report(json, bin, id).slice(0, 20) }, null, 2));
}
