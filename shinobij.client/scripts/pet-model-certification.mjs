import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import sharp from "sharp";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { runtimePetModels } from "./lib/pet-runtime-audit.mjs";

const clientRoot = resolve(import.meta.dirname, "..");
const modelRoot = resolve(clientRoot, "public/pet-models");
const rosterRoot = resolve(modelRoot, "roster");
const outputRoot = resolve(clientRoot, ".tmp/pet-model-certification");
await MeshoptDecoder.ready;
const coreClips = new Set(["attack", "death", "gallop", "gallop_jump", "idle", "idle_2", "idle_hitreact1", "walk"]);
const identityClips = new Set([...coreClips, "entrance", "cast", "guard", "rest", "victory"]);
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

function normalizedAccessorReader(glb, index) {
    const reader = decodedAccessorReader(glb, index);
    return { ...reader, value: (vertex, component = 0) => normalizedComponent(reader.value(vertex, component), reader.accessor.componentType, reader.accessor.normalized) };
}

/** Validate the decoded streams even when meshopt stored them in a fallback
 * buffer. Metadata alone cannot reveal NaNs, bad indices or invalid bindings. */
function validatePrimitiveStreams(glb, primitive, id, requireRig) {
    const position = normalizedAccessorReader(glb, primitive.attributes.POSITION);
    for (const [name, width] of [['POSITION', 3], ['NORMAL', 3], ['TEXCOORD_0', 2], ...(requireRig ? [['JOINTS_0', 4], ['WEIGHTS_0', 4]] : [])]) {
        const stream = normalizedAccessorReader(glb, primitive.attributes[name]);
        invariant(stream.width === width && stream.accessor.count === position.accessor.count, id + ': incomplete ' + name);
        for (let vertex = 0; vertex < stream.accessor.count; vertex++) for (let axis = 0; axis < width; axis++) {
            const value = stream.value(vertex, axis);
            invariant(Number.isFinite(value), id + ': non-finite ' + name);
            if (name === 'WEIGHTS_0') invariant(value >= 0 && value <= 1, id + ': invalid skin influence');
            if (name === 'JOINTS_0') invariant(Number.isInteger(value) && value >= 0 && value < glb.json.skins[0].joints.length, id + ': missing joint');
        }
    }
    const indices = decodedAccessorReader(glb, primitive.indices);
    invariant(indices.accessor.count % 3 === 0, id + ': non-triangular index stream');
    for (let index = 0; index < indices.accessor.count; index++) invariant(indices.value(index) >= 0 && indices.value(index) < position.accessor.count, id + ': out-of-range triangle index');
    if (requireRig) {
        const weights = normalizedAccessorReader(glb, primitive.attributes.WEIGHTS_0);
        for (let vertex = 0; vertex < weights.accessor.count; vertex++) {
            const sum = [0, 1, 2, 3].reduce((total, axis) => total + weights.value(vertex, axis), 0);
            invariant(Math.abs(sum - 1) <= 0.015, id + ': unnormalized skin weights');
        }
    }
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

    const inverseBindValues = decodedAccessorReader(glb, skin.inverseBindMatrices);
    for (let joint = 0; joint < inverseBindValues.accessor.count; joint++) for (let value = 0; value < 16; value++) {
        invariant(Number.isFinite(inverseBindValues.value(joint, value)), id + ': non-finite inverse bind matrix');
    }
    const identityAuthored = ["individual-species-performance-v5", "bespoke-species-performance-v3"]
        .includes(glb.json.extras?.animationAuthoring);
    invariant(identityAuthored, id + ': production identity animation bank missing');
    const expectedClips = identityClips;
    invariant(glb.json.animations?.length === expectedClips.size, `${id}: reviewed ${expectedClips.size}-clip performance bank missing`);
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
            const times = normalizedAccessorReader(glb, sampler.input);
            const values = normalizedAccessorReader(glb, sampler.output);
            for (let key = 0; key < times.accessor.count; key++) {
                const time = times.value(key);
                invariant(Number.isFinite(time) && (key === 0 || time > times.value(key - 1)), id + '/' + animation.name + ': invalid keyframe chronology');
            }
            for (let key = 0; key < values.accessor.count; key++) for (let axis = 0; axis < values.width; axis++) {
                invariant(Number.isFinite(values.value(key, axis)), id + '/' + animation.name + ': non-finite keyframe value');
            }
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
    invariant(primitive, `${id}: production surface missing`);
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
    const positions = normalizedAccessorReader(glb, primitive.attributes?.POSITION);
    const normals = normalizedAccessorReader(glb, primitive.attributes?.NORMAL);
    const indices = decodedAccessorReader(glb, primitive.indices);
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

    if (rejectOversizedDetachedProxy) {
        const components = compressedComponentMetrics(glb, primitive, id, Math.max(...size));
        const oversized = components.slice(1).find(component => component.spanRatio > 0.45);
        invariant(!oversized, id + ': detached proxy/cage spans ' + ((oversized?.spanRatio ?? 0) * 100).toFixed(1) + '% of the model');
    }

    let validWeightRatio = null;
    let maxJoint = null;
    let tailWeightedVertexRatio = null;
    if (requireRig) {
        const weights = decodedAccessorReader(glb, primitive.attributes?.WEIGHTS_0);
        const joints = decodedAccessorReader(glb, primitive.attributes?.JOINTS_0);
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
        compressed: meshoptCompressed,
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
    const primitive = glb.json.meshes?.[0]?.primitives?.[0];
    const material = glb.json.materials?.[primitive?.material];
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const texture = glb.json.textures?.[textureIndex];
    const imageIndex = texture?.extensions?.EXT_texture_webp?.source
        ?? texture?.extensions?.KHR_texture_basisu?.source
        ?? texture?.source;
    const image = glb.json.images?.[imageIndex];
    invariant(image, `${id}: authored base-color atlas is missing`);
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
    invariant(glb.json.materials?.length > 0, id + ': production materials missing');
    const primitives = glb.json.meshes?.[0]?.primitives ?? [];
    const faceFeatures = [];
    const usedMaterials = new Set();
    for (const [index, primitive] of primitives.entries()) {
        validatePrimitiveStreams(glb, primitive, id + '/primitive-' + index, requireRig);
        const material = glb.json.materials[primitive.material];
        invariant(material, id + ': missing primitive material');
        usedMaterials.add(primitive.material);
        if (index === 0) continue;
        const features = primitive.extras?.raijinFaceFeatures;
        invariant(id === 'starter-lightning-l' && Array.isArray(features) && features.length > 0, id + ': unreviewed extra geometry');
        faceFeatures.push(...features);
        const color = material.pbrMetallicRoughness?.baseColorFactor;
        invariant(Array.isArray(color) && color.length === 4 && color.every(value => Number.isFinite(value) && value >= 0 && value <= 1) && color[3] > 0, id + ': invisible or invalid face material');
        const joints = decodedAccessorReader(glb, primitive.attributes.JOINTS_0);
        const weights = normalizedAccessorReader(glb, primitive.attributes.WEIGHTS_0);
        const head = glb.json.skins[0].joints.findIndex(node => glb.json.nodes[node].name === 'head');
        for (let vertex = 0; vertex < weights.accessor.count; vertex++) {
            const share = [0, 1, 2, 3].reduce((sum, slot) => sum + (joints.value(vertex, slot) === head ? weights.value(vertex, slot) : 0), 0);
            invariant(share > 0.999, id + ': facial feature is not skull-bound');
        }
    }
    invariant(usedMaterials.size === glb.json.materials.length, id + ': unused production material');
    if (id === 'starter-lightning-l') {
        const expected = ['outline', 'gold', 'pupil', 'glint'].flatMap(part => ['eye-' + part + '-left', 'eye-' + part + '-right']).concat('nose').sort();
        invariant(JSON.stringify(faceFeatures.sort()) === JSON.stringify(expected), id + ': missing reviewed eye/nose details');
    }
    const primitive = glb.json.meshes?.[0]?.primitives?.[0];
    invariant(Number.isInteger(primitive?.material), `${id}: mesh has no material`);
    invariant(Number.isInteger(glb.json.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture?.index), `${id}: atlas is not bound to the visible surface`);
    return {
        id,
        fileBytes: file.byteLength,
        materials: glb.json.materials.length,
        primitives: primitives.length,
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
    const rosterFiles = (await readdir(rosterRoot)).filter(file => file.endsWith('.glb'));
    invariant(rosterFiles.length === 145, 'expected 145 roster assets');
    const roster = [], starters = [], failures = [];
    for (const { pet, model, path } of runtimePetModels) {
        try {
            const starter = pet.id.startsWith('starter-');
            const entry = await auditGlb(path, {
                requireRig: true, minimumAtlasBytes: starter ? 4_000 : 40_000,
                minimumVertices: starter ? 6_000 : 8_000,
                expectedJointCount: starter ? 21 : undefined,
                rejectOversizedDetachedProxy: starter,
            });
            (starter ? starters : roster).push({ ...entry, id: pet.id, assetId: model.visualId, runtimeUrl: model.url });
        } catch (error) { failures.push({ id: pet.id, assetId: model.visualId, runtimeUrl: model.url, error: error.message }); }
    }
    const report = {
        generatedAt: new Date().toISOString(),
        productionVisualForms: runtimePetModels.length,
        distinctProductionAssets: new Set(runtimePetModels.map(entry => entry.path)).size,
        auditedModels: roster.length + starters.length,
        failures, roster, starters,
        sharedStarterSubstitutions: runtimePetModels.filter(({ pet, model }) => pet.id !== model.visualId).map(({ pet, model }) => ({ id: pet.id, assetId: model.visualId })),
        possibleDuplicateAnatomy: [...roster, ...starters].filter(entry => entry.geometry.possibleDuplicateAnatomy).map(entry => ({ id: entry.id, dominantComponentRatio: entry.geometry.dominantComponentRatio, secondComponentRatio: entry.geometry.secondComponentRatio })),
        tailAnatomyExceptions: [...tailWeightExceptions].map(([id, reason]) => ({ id, reason })),
        unexpectedMissingTailWeights: roster.filter(entry => entry.geometry.tailWeightedVertexRatio === 0 && !tailWeightExceptions.has(entry.assetId)).map(entry => entry.id),
    };
    await mkdir(outputRoot, { recursive: true });
    await writeFile(resolve(outputRoot, 'structural-audit.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ attempted: report.productionVisualForms, passed: report.auditedModels, distinctAssets: report.distinctProductionAssets, failures, possibleDuplicateAnatomy: report.possibleDuplicateAnatomy, missingTailWeights: report.unexpectedMissingTailWeights }, null, 2));
    console.log('Report: ' + resolve(outputRoot, 'structural-audit.json'));
    if (failures.length || report.possibleDuplicateAnatomy.length || report.unexpectedMissingTailWeights.length) process.exitCode = 1;
}

await main();
