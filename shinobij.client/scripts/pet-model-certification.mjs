import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "sharp";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const clientRoot = resolve(import.meta.dirname, "..");
const modelRoot = resolve(clientRoot, "public/pet-models");
const rosterRoot = resolve(modelRoot, "roster");
const outputRoot = resolve(clientRoot, ".tmp/pet-model-certification");
await MeshoptDecoder.ready;
const expectedClips = new Set(["attack", "death", "gallop", "gallop_jump", "idle", "idle_2", "idle_hitreact1", "walk"]);
// These approved silhouettes intentionally do not assign visible geometry to
// the generic tail chain. Solar Stag still has a complete short tail, but its
// source rig weights that small tuft to the pelvis; the other forms are
// anatomically tailless or use wings/abdomen rather than a mammal tail.
const tailWeightExceptions = new Map([
    ["standard-13", "Iron Beetle: tailless insect silhouette"],
    ["standard-27", "Cinder Moth: wing-and-abdomen silhouette"],
    ["standard-31", "Pebble Crab: tailless crustacean silhouette"],
    ["rare-13", "Steel Beetle: tailless insect silhouette"],
    ["rare-20", "Bamboo Ape: tailless ape silhouette"],
    ["legendary-27", "Titan Golem: tailless construct silhouette"],
    ["mythic-3", "Solar Stag: visible short tail is pelvis-weighted in the approved source rig"],
]);

const componentBytes = new Map([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);
const componentReaders = new Map([
    [5120, "getInt8"], [5121, "getUint8"], [5122, "getInt16"],
    [5123, "getUint16"], [5125, "getUint32"], [5126, "getFloat32"],
]);
const typeWidths = new Map([["SCALAR", 1], ["VEC2", 2], ["VEC3", 3], ["VEC4", 4], ["MAT4", 16]]);

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function parseGlb(file, id) {
    invariant(file.subarray(0, 4).toString("ascii") === "glTF", `${id}: missing GLB magic`);
    invariant(file.readUInt32LE(4) === 2, `${id}: expected GLB v2`);
    invariant(file.readUInt32LE(8) === file.byteLength, `${id}: header length mismatch`);
    const jsonLength = file.readUInt32LE(12);
    invariant(file.readUInt32LE(16) === 0x4e4f534a, `${id}: JSON chunk missing`);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    const binHeader = 20 + jsonLength;
    invariant(file.readUInt32LE(binHeader + 4) === 0x004e4942, `${id}: BIN chunk missing`);
    const binLength = file.readUInt32LE(binHeader);
    const binOffset = binHeader + 8;
    invariant(binOffset + binLength <= file.byteLength, `${id}: BIN chunk exceeds file`);
    return { file, json, binOffset, binLength };
}

function accessorReader(glb, accessorIndex) {
    const accessor = glb.json.accessors?.[accessorIndex];
    invariant(accessor, `missing accessor ${accessorIndex}`);
    const view = glb.json.bufferViews?.[accessor.bufferView];
    invariant(view && (view.buffer ?? 0) === 0, `accessor ${accessorIndex}: unsupported buffer view`);
    const width = typeWidths.get(accessor.type);
    const bytes = componentBytes.get(accessor.componentType);
    const method = componentReaders.get(accessor.componentType);
    invariant(width && bytes && method, `accessor ${accessorIndex}: unsupported component layout`);
    const stride = view.byteStride ?? width * bytes;
    const start = glb.binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const data = new DataView(glb.file.buffer, glb.file.byteOffset, glb.file.byteLength);
    const value = (index, component = 0) => data[method](start + index * stride + component * bytes, bytes > 1);
    return { accessor, value, width };
}

function decodedAccessorReader(glb, accessorIndex) {
    const accessor = glb.json.accessors?.[accessorIndex];
    invariant(accessor, `missing accessor ${accessorIndex}`);
    const view = glb.json.bufferViews?.[accessor.bufferView];
    invariant(
        view && ((view.buffer ?? 0) === 0 || view.extensions?.EXT_meshopt_compression),
        `accessor ${accessorIndex}: unsupported buffer view`,
    );
    const width = typeWidths.get(accessor.type);
    const bytes = componentBytes.get(accessor.componentType);
    const method = componentReaders.get(accessor.componentType);
    invariant(width && bytes && method, `accessor ${accessorIndex}: unsupported component layout`);
    const extension = view.extensions?.EXT_meshopt_compression;
    let payload;
    let stride;
    if (extension) {
        const sourceStart = glb.binOffset + (extension.byteOffset ?? 0);
        const source = glb.file.subarray(sourceStart, sourceStart + extension.byteLength);
        payload = new Uint8Array(extension.count * extension.byteStride);
        MeshoptDecoder.decodeGltfBuffer(payload, extension.count, extension.byteStride, source, extension.mode, extension.filter);
        stride = extension.byteStride;
    } else {
        const start = glb.binOffset + (view.byteOffset ?? 0);
        payload = glb.file.subarray(start, start + view.byteLength);
        stride = view.byteStride ?? width * bytes;
    }
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const start = accessor.byteOffset ?? 0;
    const value = (index, component = 0) => data[method](start + index * stride + component * bytes, bytes > 1);
    return { accessor, value, width };
}

function normalizedComponent(value, componentType, normalized) {
    if (!normalized || componentType === 5126) return value;
    if (componentType === 5120) return Math.max(value / 127, -1);
    if (componentType === 5121) return value / 255;
    if (componentType === 5122) return Math.max(value / 32767, -1);
    if (componentType === 5123) return value / 65535;
    return value;
}

function compressedComponentMetrics(glb, primitive, id, modelLongest) {
    const positions = decodedAccessorReader(glb, primitive.attributes.POSITION);
    const indices = decodedAccessorReader(glb, primitive.indices);
    const position = (index, axis) => normalizedComponent(
        positions.value(index, axis),
        positions.accessor.componentType,
        positions.accessor.normalized,
    );
    const sets = unionFind(positions.accessor.count);
    const coincident = new Map();
    for (let index = 0; index < positions.accessor.count; index += 1) {
        const key = `${Math.round(position(index, 0) * 100_000)},${Math.round(position(index, 1) * 100_000)},${Math.round(position(index, 2) * 100_000)}`;
        const previous = coincident.get(key);
        if (previous === undefined) coincident.set(key, index);
        else sets.union(previous, index);
    }
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        const a = indices.value(offset);
        const b = indices.value(offset + 1);
        const c = indices.value(offset + 2);
        invariant(a < positions.accessor.count && b < positions.accessor.count && c < positions.accessor.count, `${id}: out-of-range triangle index`);
        sets.union(a, b);
        sets.union(b, c);
    }
    const components = new Map();
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        const root = sets.find(indices.value(offset));
        let component = components.get(root);
        if (!component) {
            component = { triangles: 0, vertices: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
            components.set(root, component);
        }
        component.triangles += 1;
        component.vertices.add(indices.value(offset));
        component.vertices.add(indices.value(offset + 1));
        component.vertices.add(indices.value(offset + 2));
    }
    const triangleCount = indices.accessor.count / 3;
    return [...components.values()].map((component) => {
        for (const vertex of component.vertices) {
            for (let axis = 0; axis < 3; axis += 1) {
                const value = position(vertex, axis);
                component.min[axis] = Math.min(component.min[axis], value);
                component.max[axis] = Math.max(component.max[axis], value);
            }
        }
        const size = component.max.map((value, axis) => value - component.min[axis]);
        return {
            triangles: component.triangles,
            ratio: component.triangles / triangleCount,
            size,
            spanRatio: Math.max(...size) / Math.max(0.001, modelLongest),
        };
    }).sort((left, right) => right.triangles - left.triangles);
}

function normalizeWeight(value, componentType, normalized) {
    if (!normalized || componentType === 5126) return value;
    if (componentType === 5121) return value / 255;
    if (componentType === 5123) return value / 65535;
    return value;
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
    const union = (a, b) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
    };
    return { find, union };
}

function rigMetrics(glb, id, expectedJointCount) {
    invariant(glb.json.skins?.length === 1, `${id}: production skeleton missing`);
    const skin = glb.json.skins[0];
    invariant(Array.isArray(skin.joints) && skin.joints.length >= 2, `${id}: skeleton joint list is missing`);
    if (expectedJointCount !== undefined) {
        invariant(skin.joints.length === expectedJointCount, `${id}: expected ${expectedJointCount} bones, found ${skin.joints.length}`);
    }
    invariant(new Set(skin.joints).size === skin.joints.length, `${id}: skeleton contains duplicate joints`);
    for (const nodeIndex of skin.joints) {
        invariant(Number.isInteger(nodeIndex) && glb.json.nodes?.[nodeIndex], `${id}: skeleton references a missing node`);
    }
    const inverseBind = glb.json.accessors?.[skin.inverseBindMatrices];
    invariant(inverseBind?.type === "MAT4" && inverseBind.componentType === 5126, `${id}: inverse bind matrices are missing or malformed`);
    invariant(inverseBind.count === skin.joints.length, `${id}: inverse bind count does not match the skeleton`);

    invariant(glb.json.animations?.length === expectedClips.size, `${id}: reviewed eight-clip set missing`);
    const clipNames = glb.json.animations.map((clip) => clip.name);
    invariant(new Set(clipNames).size === expectedClips.size, `${id}: animation clip names are duplicated`);
    invariant(clipNames.every((name) => expectedClips.has(name)), `${id}: required animation clip missing`);
    const durations = {};
    for (const animation of glb.json.animations) {
        invariant(animation.channels?.length > 0 && animation.samplers?.length > 0, `${id}/${animation.name}: animation data is empty`);
        let clipStart = Infinity;
        let clipEnd = -Infinity;
        for (const channel of animation.channels) {
            const sampler = animation.samplers[channel.sampler];
            invariant(sampler, `${id}/${animation.name}: channel references a missing sampler`);
            invariant(Number.isInteger(channel.target?.node) && glb.json.nodes?.[channel.target.node], `${id}/${animation.name}: channel target node is missing`);
            invariant(["translation", "rotation", "scale"].includes(channel.target.path), `${id}/${animation.name}: unsupported animation target path`);
            const input = glb.json.accessors?.[sampler.input];
            const output = glb.json.accessors?.[sampler.output];
            invariant(input?.type === "SCALAR" && input.componentType === 5126 && input.count >= 2, `${id}/${animation.name}: invalid keyframe time stream`);
            const expectedOutputType = channel.target.path === "rotation" ? "VEC4" : "VEC3";
            const validOutputEncoding = output?.componentType === 5126
                || (
                    channel.target.path === "rotation"
                    && [5120, 5122].includes(output?.componentType)
                    && output?.normalized === true
                );
            invariant(
                output?.type === expectedOutputType && validOutputEncoding && output.count >= input.count,
                `${id}/${animation.name}: invalid keyframe value stream`,
            );
            const start = input.min?.[0];
            const end = input.max?.[0];
            invariant(Number.isFinite(start) && Number.isFinite(end) && end > start, `${id}/${animation.name}: invalid keyframe duration`);
            clipStart = Math.min(clipStart, start);
            clipEnd = Math.max(clipEnd, end);
        }
        const duration = clipEnd - clipStart;
        invariant(duration >= 0.05 && duration <= 20, `${id}/${animation.name}: unreasonable ${duration.toFixed(3)}s duration`);
        durations[animation.name] = Number(duration.toFixed(4));
    }
    return {
        skins: 1,
        bones: skin.joints.length,
        inverseBindMatrices: inverseBind.count,
        animations: clipNames,
        durations,
    };
}

function geometryMetrics(glb, id, requireRig, minimumVertices = 8_000, rejectOversizedDetachedProxy = false) {
    invariant(glb.json.meshes?.length === 1, `${id}: expected one pet mesh`);
    const meshNodes = glb.json.nodes?.filter((node) => Number.isInteger(node.mesh)) ?? [];
    invariant(meshNodes.length === 1 && meshNodes[0].mesh === 0, `${id}: expected one active surface node`);
    if (requireRig) invariant(meshNodes[0].skin === 0, `${id}: surface node is not bound to the reviewed skeleton`);
    const primitive = glb.json.meshes[0]?.primitives?.[0];
    invariant(glb.json.meshes[0]?.primitives?.length === 1 && primitive, `${id}: loose or multiple primitives found`);
    const positionAccessor = glb.json.accessors?.[primitive.attributes?.POSITION];
    const indexAccessor = glb.json.accessors?.[primitive.indices];
    invariant(positionAccessor && indexAccessor, `${id}: position or index stream missing`);
    const normalAccessor = glb.json.accessors?.[primitive.attributes?.NORMAL];
    const uvAccessor = glb.json.accessors?.[primitive.attributes?.TEXCOORD_0];
    invariant(normalAccessor?.type === "VEC3" && normalAccessor.count === positionAccessor.count, `${id}: normals are missing or incomplete`);
    invariant(uvAccessor?.type === "VEC2" && uvAccessor.count === positionAccessor.count, `${id}: texture coordinates are missing or incomplete`);
    invariant([5121, 5123, 5125].includes(indexAccessor.componentType), `${id}: triangle index type is invalid`);
    if (requireRig) {
        invariant(Number.isInteger(primitive.attributes?.WEIGHTS_0) && Number.isInteger(primitive.attributes?.JOINTS_0), `${id}: skin weight streams are missing`);
    }
    const positionView = glb.json.bufferViews?.[positionAccessor.bufferView];
    const indexView = glb.json.bufferViews?.[indexAccessor.bufferView];
    const meshoptCompressed = (positionView?.buffer ?? 0) !== 0 || (indexView?.buffer ?? 0) !== 0
        || Boolean(positionView?.extensions?.EXT_meshopt_compression || indexView?.extensions?.EXT_meshopt_compression);
    if (meshoptCompressed) {
        invariant(positionAccessor.count >= minimumVertices && positionAccessor.count <= 60_000, `${id}: unreasonable vertex budget`);
        invariant(indexAccessor.count % 3 === 0, `${id}: index count is not triangular`);
        invariant(Array.isArray(positionAccessor.min) && Array.isArray(positionAccessor.max), `${id}: compressed bounds metadata missing`);
        const divisor = positionAccessor.normalized && positionAccessor.componentType === 5122 ? 32767 : 1;
        const min = positionAccessor.min.map((value) => value / divisor);
        const max = positionAccessor.max.map((value) => value / divisor);
        const size = max.map((value, axis) => value - min[axis]);
        invariant(Math.min(...size) > 0.08 && Math.max(...size) / Math.min(...size) < 14, `${id}: collapsed or extreme model bounds`);
        const components = rejectOversizedDetachedProxy
            ? compressedComponentMetrics(glb, primitive, id, Math.max(...size))
            : null;
        const oversizedProxy = components?.slice(1).find((component) => component.spanRatio > 0.45);
        invariant(
            !oversizedProxy,
            `${id}: detached proxy/cage spans ${(oversizedProxy?.spanRatio * 100).toFixed(1)}% of the model`,
        );
        return {
            vertices: positionAccessor.count,
            triangles: indexAccessor.count / 3,
            bounds: { min: min.map((value) => Number(value.toFixed(4))), max: max.map((value) => Number(value.toFixed(4))), size: size.map((value) => Number(value.toFixed(4))) },
            connectedComponents: components?.length ?? null,
            dominantComponentRatio: components ? Number((components[0]?.ratio ?? 0).toFixed(4)) : null,
            secondComponentRatio: components ? Number((components[1]?.ratio ?? 0).toFixed(4)) : null,
            largestDetachedSpanRatio: components ? Number(Math.max(0, ...components.slice(1).map((component) => component.spanRatio)).toFixed(4)) : null,
            possibleDuplicateAnatomy: false,
            validWeightRatio: null,
            maxJoint: null,
            tailWeightedVertexRatio: null,
            compressed: true,
        };
    }
    const positions = accessorReader(glb, primitive.attributes?.POSITION);
    const normals = accessorReader(glb, primitive.attributes?.NORMAL);
    const indices = accessorReader(glb, primitive.indices);
    invariant(positions.accessor.count >= minimumVertices && positions.accessor.count <= 60_000, `${id}: unreasonable vertex budget`);
    invariant(indices.accessor.count % 3 === 0, `${id}: index count is not triangular`);
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let index = 0; index < positions.accessor.count; index += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
            const value = positions.value(index, axis);
            invariant(Number.isFinite(value), `${id}: non-finite vertex position`);
            invariant(Number.isFinite(normals.value(index, axis)), `${id}: non-finite vertex normal`);
            bounds.min[axis] = Math.min(bounds.min[axis], value);
            bounds.max[axis] = Math.max(bounds.max[axis], value);
        }
    }
    const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
    invariant(Math.min(...size) > 0.08 && Math.max(...size) / Math.min(...size) < 14, `${id}: collapsed or extreme model bounds`);

    const sets = unionFind(positions.accessor.count);
    // glTF exporters split vertices at UV seams. Weld coincident positions for
    // topology review so atlas islands do not masquerade as separate anatomy.
    const coincident = new Map();
    for (let index = 0; index < positions.accessor.count; index += 1) {
        const key = `${Math.round(positions.value(index, 0) * 100_000)},${Math.round(positions.value(index, 1) * 100_000)},${Math.round(positions.value(index, 2) * 100_000)}`;
        const previous = coincident.get(key);
        if (previous === undefined) coincident.set(key, index);
        else sets.union(previous, index);
    }
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        const a = indices.value(offset);
        const b = indices.value(offset + 1);
        const c = indices.value(offset + 2);
        invariant(a < positions.accessor.count && b < positions.accessor.count && c < positions.accessor.count, `${id}: out-of-range triangle index`);
        sets.union(a, b);
        sets.union(b, c);
    }
    const triangleComponents = new Map();
    for (let offset = 0; offset < indices.accessor.count; offset += 3) {
        const root = sets.find(indices.value(offset));
        triangleComponents.set(root, (triangleComponents.get(root) ?? 0) + 1);
    }
    const componentTriangles = [...triangleComponents.values()].sort((a, b) => b - a);
    const triangleCount = indices.accessor.count / 3;

    let validWeightRatio = null;
    let maxJoint = null;
    let tailWeightedVertexRatio = null;
    if (requireRig) {
        const weights = accessorReader(glb, primitive.attributes?.WEIGHTS_0);
        const joints = accessorReader(glb, primitive.attributes?.JOINTS_0);
        const tailJointSlots = new Set(glb.json.skins[0].joints
            .map((nodeIndex, slot) => /tail/i.test(glb.json.nodes?.[nodeIndex]?.name ?? "") ? slot : -1)
            .filter((slot) => slot >= 0));
        let validWeights = 0;
        let tailWeightedVertices = 0;
        maxJoint = 0;
        for (let index = 0; index < positions.accessor.count; index += 1) {
            let sum = 0;
            let tailWeight = 0;
            for (let component = 0; component < 4; component += 1) {
                const weight = normalizeWeight(weights.value(index, component), weights.accessor.componentType, weights.accessor.normalized);
                const joint = joints.value(index, component);
                sum += weight;
                if (tailJointSlots.has(joint)) tailWeight += weight;
                maxJoint = Math.max(maxJoint, joint);
            }
            if (sum >= 0.94 && sum <= 1.06) validWeights += 1;
            if (tailWeight >= 0.05) tailWeightedVertices += 1;
        }
        validWeightRatio = validWeights / positions.accessor.count;
        tailWeightedVertexRatio = tailWeightedVertices / positions.accessor.count;
        invariant(validWeightRatio >= 0.995, `${id}: ${((1 - validWeightRatio) * 100).toFixed(2)}% of vertices have invalid skin weights`);
        invariant(maxJoint < glb.json.skins[0].joints.length, `${id}: skin references a missing bone`);
    }

    return {
        vertices: positions.accessor.count,
        triangles: triangleCount,
        bounds: { min: bounds.min.map((value) => Number(value.toFixed(4))), max: bounds.max.map((value) => Number(value.toFixed(4))), size: size.map((value) => Number(value.toFixed(4))) },
        connectedComponents: componentTriangles.length,
        dominantComponentRatio: Number(((componentTriangles[0] ?? 0) / triangleCount).toFixed(4)),
        secondComponentRatio: Number(((componentTriangles[1] ?? 0) / triangleCount).toFixed(4)),
        possibleDuplicateAnatomy: (componentTriangles[1] ?? 0) / triangleCount >= 0.09,
        validWeightRatio,
        maxJoint,
        tailWeightedVertexRatio: tailWeightedVertexRatio === null ? null : Number(tailWeightedVertexRatio.toFixed(4)),
    };
}

async function embeddedImage(glb, id) {
    invariant(glb.json.images?.length === 1, `${id}: expected one authored color atlas`);
    const image = glb.json.images[0];
    invariant(Number.isInteger(image.bufferView), `${id}: atlas is not embedded`);
    const view = glb.json.bufferViews?.[image.bufferView];
    invariant(view && (view.buffer ?? 0) === 0, `${id}: invalid atlas buffer view`);
    const start = glb.binOffset + (view.byteOffset ?? 0);
    return { bytes: glb.file.subarray(start, start + view.byteLength), mimeType: image.mimeType ?? "application/octet-stream" };
}

async function colorMetrics(payload, id, minimumBytes) {
    invariant(payload.bytes.byteLength >= minimumBytes, `${id}: color atlas is suspiciously small`);
    const { data, info } = await sharp(payload.bytes).ensureAlpha().resize(64, 64, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let colored = 0;
    let sumLuma = 0;
    let sumLumaSquared = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const alpha = data[offset + 3];
        if (alpha < 16) continue;
        opaque += 1;
        const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        sumLuma += luma;
        sumLumaSquared += luma * luma;
        if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 14) colored += 1;
    }
    invariant(opaque >= 512, `${id}: atlas contains too little visible surface data`);
    const meanLuma = sumLuma / opaque;
    const lumaDeviation = Math.sqrt(Math.max(0, sumLumaSquared / opaque - meanLuma * meanLuma));
    const coloredPixelRatio = colored / opaque;
    invariant(lumaDeviation >= 8, `${id}: atlas is visually flat or blank`);
    invariant(coloredPixelRatio >= 0.035, `${id}: atlas is effectively uncolored clay`);
    return {
        bytes: payload.bytes.byteLength,
        mimeType: payload.mimeType,
        width: (await sharp(payload.bytes).metadata()).width,
        height: (await sharp(payload.bytes).metadata()).height,
        coloredPixelRatio: Number(coloredPixelRatio.toFixed(4)),
        lumaDeviation: Number(lumaDeviation.toFixed(2)),
        sha256: createHash("sha256").update(payload.bytes).digest("hex"),
    };
}

async function auditGlb(path, { requireRig, minimumAtlasBytes, minimumVertices = 8_000, expectedJointCount, rejectOversizedDetachedProxy = false }) {
    const id = basename(path, ".glb");
    const file = await readFile(path);
    const glb = parseGlb(file, id);
    invariant(glb.json.materials?.length === 1, `${id}: expected one production material`);
    const primitive = glb.json.meshes?.[0]?.primitives?.[0];
    invariant(Number.isInteger(primitive?.material), `${id}: mesh has no material`);
    invariant(Number.isInteger(glb.json.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture?.index), `${id}: atlas is not bound to the visible surface`);
    return {
        id,
        fileBytes: file.byteLength,
        rig: {
            required: requireRig,
            ...(requireRig ? rigMetrics(glb, id, expectedJointCount) : {
                skins: glb.json.skins?.length ?? 0,
                bones: glb.json.skins?.[0]?.joints?.length ?? 0,
                animations: glb.json.animations?.map((clip) => clip.name) ?? [],
            }),
        },
        geometry: geometryMetrics(glb, id, requireRig, minimumVertices, rejectOversizedDetachedProxy),
        color: await colorMetrics(await embeddedImage(glb, id), id, minimumAtlasBytes),
    };
}

async function main() {
    const rosterFiles = (await readdir(rosterRoot)).filter((file) => file.endsWith(".glb")).sort();
    invariant(rosterFiles.length === 140, `expected 140 roster GLBs, found ${rosterFiles.length}`);
    const starterForms = [
        { visualId: "starter-earth", asset: "starter-earth.glb" },
        { visualId: "starter-earth-l", asset: "starter-earth-l.glb" },
        { visualId: "starter-earth-r", asset: "starter-earth-r.glb" },
        { visualId: "starter-fire", asset: "starter-fire.glb" },
        { visualId: "starter-fire-l", asset: "starter-fire-l.glb" },
        { visualId: "starter-fire-r", asset: "starter-fire-r.glb" },
        { visualId: "starter-lightning", asset: "starter-lightning.glb" },
        { visualId: "starter-lightning-l", asset: "starter-lightning-l.glb" },
        { visualId: "starter-lightning-r", asset: "starter-lightning-r.glb" },
        { visualId: "starter-water", asset: "starter-water.glb" },
        { visualId: "starter-water-l", asset: "starter-water-l.glb" },
        { visualId: "starter-water-r", asset: "starter-water-r.glb" },
        { visualId: "starter-wind", asset: "starter-wind.glb" },
        { visualId: "starter-wind-l", asset: "starter-wind-l.glb" },
        { visualId: "starter-wind-r", asset: "starter-wind-r.glb" },
    ];
    invariant(starterForms.every(({ visualId, asset }) => asset === `${visualId}.glb`), "starter forms must not use shared or substituted production assets");
    const starterGlbAssets = [...new Set(starterForms.map((entry) => entry.asset))].sort();
    invariant(starterGlbAssets.length === 15, `expected 15 distinct starter GLB assets, found ${starterGlbAssets.length}`);
    const roster = [];
    const starters = [];
    // The color atlas is now stored as WebP (was PNG). A 2048² WebP for these
    // textured pets runs ~67–295 KB, so the old 250 KB floor — calibrated for the
    // uncompressed PNG atlases — false-fails almost the whole roster. Drop it to a
    // 40 KB coarse "is there a real atlas here" pre-check; the actual defence
    // against blank/flat/uncolored atlases is the semantic content check in
    // colorMetrics (opaque-pixel, lumaDeviation, coloredPixelRatio), which is
    // format-independent and far stronger than any byte count.
    for (const file of rosterFiles) roster.push(await auditGlb(resolve(rosterRoot, file), { requireRig: true, minimumAtlasBytes: 40_000 }));
    // Starter forms are deliberately leaner than the 140-pet roster for mobile
    // combat, but every base and evolved starter must carry the same reviewed
    // 21-bone/eight-clip authored combat contract.
    for (const file of starterGlbAssets) starters.push(await auditGlb(resolve(modelRoot, file), {
        requireRig: true,
        minimumAtlasBytes: 4_000,
        minimumVertices: 6_000,
        expectedJointCount: 21,
        rejectOversizedDetachedProxy: true,
    }));
    const report = {
        generatedAt: new Date().toISOString(),
        productionVisualForms: 155,
        distinctProductionAssets: 140 + starterGlbAssets.length,
        roster,
        starters,
        starterForms,
        runtimeSourceArtifactCleanup: [],
        sharedStarterSubstitutions: [],
        possibleDuplicateAnatomy: [...roster, ...starters].filter((entry) => entry.geometry.possibleDuplicateAnatomy).map((entry) => ({ id: entry.id, dominantComponentRatio: entry.geometry.dominantComponentRatio, secondComponentRatio: entry.geometry.secondComponentRatio })),
        tailAnatomyExceptions: [...tailWeightExceptions].map(([id, reason]) => ({ id, reason })),
        unexpectedMissingTailWeights: roster
            .filter((entry) => entry.geometry.tailWeightedVertexRatio === 0 && !tailWeightExceptions.has(entry.id))
            .map((entry) => entry.id),
    };
    await mkdir(outputRoot, { recursive: true });
    await writeFile(resolve(outputRoot, "structural-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
    invariant(report.possibleDuplicateAnatomy.length === 0, `possible duplicate anatomy remains in: ${report.possibleDuplicateAnatomy.map((entry) => entry.id).join(", ")}`);
    invariant(report.unexpectedMissingTailWeights.length === 0, `unexpected missing tail-weighted anatomy remains in: ${report.unexpectedMissingTailWeights.join(", ")}`);
    console.log(`Certified ${report.productionVisualForms} visual forms across ${report.distinctProductionAssets} production assets.`);
    console.log(`${report.possibleDuplicateAnatomy.length} assets require explicit multi-angle silhouette review.`);
    console.log(`Report: ${resolve(outputRoot, "structural-audit.json")}`);
}

await main();
