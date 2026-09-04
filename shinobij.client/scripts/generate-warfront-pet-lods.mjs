/**
 * Build and certify the eight-rig Warfront LOD bank.
 *
 * The source GLBs remain the close-up/menu assets. This script decodes their
 * existing meshopt payload, simplifies indexed triangles without locking UV
 * seams, and writes a second, battle-only GLB with the skeleton, weights,
 * material atlas, and complete authored animation bank intact.
 *
 * Usage:
 *   node scripts/generate-warfront-pet-lods.mjs
 *   node scripts/generate-warfront-pet-lods.mjs --check
 *   node scripts/generate-warfront-pet-lods.mjs --critical-only
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(clientRoot, "public");
const modelRoot = resolve(publicRoot, "pet-models");
const outputRoot = resolve(modelRoot, "warfront-lod");
const jsonManifestPath = resolve(outputRoot, "manifest.json");
const tsManifestPath = resolve(clientRoot, "src/generated/pet-warfront-lod-manifest.ts");

const REVISION = "20260902-battle-lod-v1";
const TARGET_LOD_TRIANGLES = 10_000;
const MAX_LOD_TRIANGLES = 15_000;
const MAX_ERROR = 0.05;
const MIN_TRIANGLE_REDUCTION = 0.6;
const MAX_BOUNDS_DELTA = 0.02;
const MIN_SILHOUETTE_IOU = 0.975;
const SILHOUETTE_SIZE = 96;
const LOW_POLY_SOURCE_LIMIT = 25_000;
const EXPECTED_RUNTIME_SOURCE_COUNT = 159;
const CRITICAL_BUILT_IN_FILES = new Set([
    "pet-models/roster/mythic-0.glb",
    "pet-models/roster/mythic-2.glb",
    "pet-models/roster/mythic-3.glb",
    "pet-models/roster/mythic-4.glb",
]);

const argv = new Set(process.argv.slice(2));
const checkOnly = argv.has("--check");
const criticalOnly = argv.has("--critical-only");
const quiet = argv.has("--quiet");
const modelFilter = process.argv.slice(2).find((value) => value.startsWith("--model="))?.slice("--model=".length);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        "meshopt.decoder": MeshoptDecoder,
        "meshopt.encoder": MeshoptEncoder,
    });

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function slash(path) {
    return path.split(sep).join("/");
}

async function existingRuntimeSources() {
    const roster = (await readdir(resolve(modelRoot, "roster"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".glb"))
        // These two identities resolve to their reviewed showdown-v2 assets.
        .filter((entry) => entry.name !== "rare-1.glb" && entry.name !== "standard-7.glb")
        .map((entry) => resolve(modelRoot, "roster", entry.name));
    const starters = (await readdir(modelRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^starter-.+\.glb$/u.test(entry.name))
        // Base Earth is backed by roster/standard-5. The two legendary hounds
        // resolve to showdown-v2, so their retired top-level files are not used.
        .filter((entry) => !new Set([
            "starter-earth.glb",
            "starter-fire-l.glb",
            "starter-lightning-l.glb",
        ]).has(entry.name))
        .map((entry) => resolve(modelRoot, entry.name));
    const showdown = (await readdir(resolve(modelRoot, "showdown-v2"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".glb"))
        .map((entry) => resolve(modelRoot, "showdown-v2", entry.name));
    const sources = [...roster, ...starters, ...showdown].sort();
    invariant(
        sources.length === EXPECTED_RUNTIME_SOURCE_COUNT,
        `Warfront source inventory changed: expected ${EXPECTED_RUNTIME_SOURCE_COUNT}, found ${sources.length}. Update the resolver audit and this manifest deliberately.`,
    );
    const selected = criticalOnly
        ? sources.filter((path) => CRITICAL_BUILT_IN_FILES.has(slash(relative(publicRoot, path))))
        : sources;
    return modelFilter ? selected.filter((path) => path.endsWith(`/${modelFilter}.glb`) || path.endsWith(`\\${modelFilter}.glb`)) : selected;
}

/**
 * Older generated roster assets require meshopt and intentionally carry no
 * fallback payload, but their JSON still points compressed bufferViews at the
 * absent fallback buffer index. Three's loader follows the extension payload;
 * glTF-Transform validates the dangling index first. Add a temporary empty
 * resource for decoding only. The writer emits valid fallback metadata.
 */
async function readDocument(path) {
    const jsonDoc = await io.readAsJSON(path);
    const maxBufferIndex = Math.max(
        -1,
        ...(jsonDoc.json.bufferViews ?? []).map((view) => view.buffer ?? -1),
    );
    while ((jsonDoc.json.buffers?.length ?? 0) <= maxBufferIndex) {
        const index = jsonDoc.json.buffers?.length ?? 0;
        const uri = `__warfront_meshopt_fallback_${index}.bin`;
        jsonDoc.json.buffers ??= [];
        jsonDoc.json.buffers.push({ byteLength: 0, uri });
        jsonDoc.resources[uri] = new Uint8Array(0);
    }
    const document = await io.readJSON(jsonDoc);
    document.setLogger(new Logger(Logger.Verbosity.ERROR));
    return document;
}

function mergeAccessorBuffers(document) {
    const root = document.getRoot();
    const buffers = root.listBuffers();
    const target = buffers[0] ?? document.createBuffer("warfront-lod");
    for (const accessor of root.listAccessors()) accessor.setBuffer(target);
    for (const buffer of buffers.slice(1)) buffer.dispose();
}

function accessorFloatArray(accessor) {
    const output = new Float32Array(accessor.getCount() * accessor.getElementSize());
    const element = new Array(accessor.getElementSize()).fill(0);
    for (let index = 0; index < accessor.getCount(); index++) {
        accessor.getElement(index, element);
        output.set(element, index * element.length);
    }
    return output;
}

/** Meshoptimizer's attribute-aware path includes deformation identity in its
 * error metric. Sparse joint IDs are categorical, so expand the four weights
 * into one dense channel per joint before simplifying. The original compact
 * JOINTS_0/WEIGHTS_0 streams are still the streams copied to the final GLB. */
function skinAwareSimplifyDocument(document, ratio) {
    const root = document.getRoot();
    const jointCount = Math.max(...root.listSkins().map((skin) => skin.listJoints().length));
    invariant(jointCount > 0 && jointCount <= 29, `unsupported Warfront joint count ${jointCount}`);
    const errors = [];
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const positions = primitive.getAttribute("POSITION");
        const normals = primitive.getAttribute("NORMAL");
        const uvs = primitive.getAttribute("TEXCOORD_0");
        const joints = primitive.getAttribute("JOINTS_0");
        const weights = primitive.getAttribute("WEIGHTS_0");
        const indices = primitive.getIndices();
        invariant(positions && normals && uvs && joints && weights && indices, `${mesh.getName()}: incomplete skinned primitive`);
        const positionArray = accessorFloatArray(positions);
        const normalArray = accessorFloatArray(normals);
        const uvArray = accessorFloatArray(uvs);
        // Meshoptimizer accepts at most 32 weighted channels. The roster's
        // 21-joint bank includes normals+UVs; the two 29-joint showcase hounds
        // use normals+dense skin and retain UV seams through indexed topology.
        const includeUvs = jointCount <= 27;
        const skinOffset = includeUvs ? 5 : 3;
        const attributeStride = skinOffset + jointCount;
        const attributes = new Float32Array(positions.getCount() * attributeStride);
        const joint = [0, 0, 0, 0];
        const weight = [0, 0, 0, 0];
        for (let vertex = 0; vertex < positions.getCount(); vertex++) {
            const offset = vertex * attributeStride;
            attributes.set(normalArray.subarray(vertex * 3, vertex * 3 + 3), offset);
            if (includeUvs) attributes.set(uvArray.subarray(vertex * 2, vertex * 2 + 2), offset + 3);
            joints.getElement(vertex, joint);
            weights.getElement(vertex, weight);
            for (let influence = 0; influence < 4; influence++) {
                invariant(joint[influence] < jointCount, `${mesh.getName()}: joint ${joint[influence]} >= ${jointCount}`);
                attributes[offset + skinOffset + joint[influence]] += weight[influence];
            }
        }
        const attributeWeights = [
            0.5, 0.5, 0.5,
            ...(includeUvs ? [0.25, 0.25] : []),
            ...new Array(jointCount).fill(1),
        ];
        const sourceIndices = indices.getArray();
        const usedVertices = [...new Set(sourceIndices)];
        const targetCount = Math.floor(sourceIndices.length * ratio / 3) * 3;
        // Preserve the six authored extent points explicitly. This is much
        // narrower than LockBorder (which locks most smart-UV meshes), while
        // guaranteeing ears, horns, tails, and paws cannot shrink the rig's
        // presentation bounds during an aggressive low-poly-source reduction.
        const vertexLock = new Uint8Array(positions.getCount());
        for (let axis = 0; axis < 3; axis++) {
            let minIndex = usedVertices[0];
            let maxIndex = usedVertices[0];
            for (const vertex of usedVertices) {
                if (positionArray[vertex * 3 + axis] < positionArray[minIndex * 3 + axis]) minIndex = vertex;
                if (positionArray[vertex * 3 + axis] > positionArray[maxIndex * 3 + axis]) maxIndex = vertex;
            }
            vertexLock[minIndex] = 1;
            vertexLock[maxIndex] = 1;
        }
        // Sample the convex silhouette in the three battle-relevant views.
        // Locking ~50–90 feature-tip vertices retains ears, wings, weapons,
        // and tails without turning every UV seam into an immutable border.
        const viewAxes = [
            [[1, 0, 0], [0, 1, 0]],
            [[0, 0, 1], [0, 1, 0]],
            [[Math.SQRT1_2, 0, -Math.SQRT1_2], [0, 1, 0]],
        ];
        for (const [uAxis, vAxis] of viewAxes) for (let step = 0; step < 32; step++) {
            const angle = step / 32 * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            let bestIndex = usedVertices[0];
            let best = -Infinity;
            for (const vertex of usedVertices) {
                const x = positionArray[vertex * 3];
                const y = positionArray[vertex * 3 + 1];
                const z = positionArray[vertex * 3 + 2];
                const score = (x * uAxis[0] + y * uAxis[1] + z * uAxis[2]) * cos
                    + (x * vAxis[0] + y * vAxis[1] + z * vAxis[2]) * sin;
                if (score > best) {
                    best = score;
                    bestIndex = vertex;
                }
            }
            vertexLock[bestIndex] = 1;
        }
        const [simplifiedIndices, error] = MeshoptSimplifier.simplifyWithAttributes(
            sourceIndices,
            positionArray,
            3,
            attributes,
            attributeStride,
            attributeWeights,
            vertexLock,
            targetCount,
            MAX_ERROR,
        );
        indices.setArray(simplifiedIndices);
        compactPrimitive(primitive);
        errors.push(error);
    }
    return errors;
}

function triangleCount(document) {
    let count = 0;
    for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
            invariant(primitive.getMode() === 4, `${mesh.getName()}: non-triangle primitive is not supported`);
            const indices = primitive.getIndices();
            const positions = primitive.getAttribute("POSITION");
            invariant(positions, `${mesh.getName()}: missing POSITION`);
            count += (indices?.getCount() ?? positions.getCount()) / 3;
        }
    }
    return count;
}

function modelStats(document) {
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    invariant(scene, "GLB has no scene");
    const bounds = getBounds(scene);
    const dimensions = bounds.max.map((value, index) => value - bounds.min[index]);
    const skins = root.listSkins().map((skin) => ({
        name: skin.getName(),
        joints: skin.listJoints().map((joint) => joint.getName()),
        inverseBindSha256: typedArraySha256(skin.getInverseBindMatrices()?.getArray()),
    }));
    const animations = root.listAnimations().map((animation) => ({
        name: animation.getName(),
        channels: animation.listChannels().length,
        duration: Math.max(0, ...animation.listSamplers().map((sampler) => sampler.getInput()?.getMax([])[0] ?? 0)),
    }));
    let vertices = 0;
    let weightedPrimitives = 0;
    let primitives = 0;
    let minWeightSum = Infinity;
    let maxWeightSum = -Infinity;
    let maxJoint = -1;
    const attributeSets = [];
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
        primitives += 1;
        attributeSets.push([...primitive.listSemantics()].sort());
        vertices += primitive.getAttribute("POSITION")?.getCount() ?? 0;
        const joints = primitive.getAttribute("JOINTS_0");
        const weights = primitive.getAttribute("WEIGHTS_0");
        if (joints && weights) {
            weightedPrimitives += 1;
            const joint = [0, 0, 0, 0];
            const weight = [0, 0, 0, 0];
            for (let index = 0; index < weights.getCount(); index++) {
                joints.getElement(index, joint);
                weights.getElement(index, weight);
                minWeightSum = Math.min(minWeightSum, weight[0] + weight[1] + weight[2] + weight[3]);
                maxWeightSum = Math.max(maxWeightSum, weight[0] + weight[1] + weight[2] + weight[3]);
                maxJoint = Math.max(maxJoint, joint[0], joint[1], joint[2], joint[3]);
            }
        }
    }
    return {
        triangles: Math.round(triangleCount(document)),
        vertices,
        bounds: { min: bounds.min, max: bounds.max, dimensions },
        skins,
        animations,
        primitives,
        weightedPrimitives,
        attributeSets,
        weightRange: [minWeightSum, maxWeightSum],
        maxJoint,
        materials: root.listMaterials().map((material) => material.getName()),
        textures: root.listTextures().map((texture) => ({
            name: texture.getName(),
            mimeType: texture.getMimeType(),
            bytes: texture.getImage()?.byteLength ?? 0,
            sha256: typedArraySha256(texture.getImage()),
        })),
    };
}

function typedArraySha256(array) {
    if (!array) return null;
    return createHash("sha256")
        .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
        .digest("hex");
}

function transformPoint(matrix, x, y, z) {
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    return [
        (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
        (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
        (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
    ];
}

function projected(point, view) {
    if (view === "front") return [point[0], point[1]];
    if (view === "side") return [point[2], point[1]];
    return [(point[0] - point[2]) * Math.SQRT1_2, point[1]];
}

function projectedBounds(bounds, view) {
    const points = [];
    for (const x of [bounds.min[0], bounds.max[0]]) {
        for (const y of [bounds.min[1], bounds.max[1]]) {
            for (const z of [bounds.min[2], bounds.max[2]]) points.push(projected([x, y, z], view));
        }
    }
    const minU = Math.min(...points.map((point) => point[0]));
    const maxU = Math.max(...points.map((point) => point[0]));
    const minV = Math.min(...points.map((point) => point[1]));
    const maxV = Math.max(...points.map((point) => point[1]));
    const padU = Math.max(1e-5, (maxU - minU) * 0.04);
    const padV = Math.max(1e-5, (maxV - minV) * 0.04);
    return { minU: minU - padU, maxU: maxU + padU, minV: minV - padV, maxV: maxV + padV };
}

function rasterizeSilhouette(document, view, frame) {
    const mask = new Uint8Array(SILHOUETTE_SIZE * SILHOUETTE_SIZE);
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const toPixel = (point) => {
        const [u, v] = projected(point, view);
        return [
            (u - frame.minU) / (frame.maxU - frame.minU) * (SILHOUETTE_SIZE - 1),
            (1 - (v - frame.minV) / (frame.maxV - frame.minV)) * (SILHOUETTE_SIZE - 1),
        ];
    };
    scene.traverse((node) => {
        const mesh = node.getMesh();
        if (!mesh) return;
        const matrix = node.getWorldMatrix();
        for (const primitive of mesh.listPrimitives()) {
            const position = primitive.getAttribute("POSITION");
            if (!position) continue;
            const indices = primitive.getIndices();
            const indexCount = indices?.getCount() ?? position.getCount();
            const cache = new Array(position.getCount());
            const point = [0, 0, 0];
            const pixelAt = (vertexIndex) => {
                if (cache[vertexIndex]) return cache[vertexIndex];
                position.getElement(vertexIndex, point);
                return (cache[vertexIndex] = toPixel(transformPoint(matrix, point[0], point[1], point[2])));
            };
            for (let offset = 0; offset + 2 < indexCount; offset += 3) {
                const a = pixelAt(indices ? indices.getScalar(offset) : offset);
                const b = pixelAt(indices ? indices.getScalar(offset + 1) : offset + 1);
                const c = pixelAt(indices ? indices.getScalar(offset + 2) : offset + 2);
                const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
                const maxX = Math.min(SILHOUETTE_SIZE - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
                const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
                const maxY = Math.min(SILHOUETTE_SIZE - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
                const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
                if (Math.abs(area) < 1e-8) continue;
                for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5;
                    const py = y + 0.5;
                    const ab = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
                    const bc = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
                    const ca = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
                    if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) {
                        mask[y * SILHOUETTE_SIZE + x] = 1;
                    }
                }
            }
        }
    });
    return mask;
}

function silhouetteIoU(source, lod, sourceBounds) {
    const scores = [];
    for (const view of ["front", "threeQuarter", "side"]) {
        const frame = projectedBounds(sourceBounds, view);
        const a = rasterizeSilhouette(source, view, frame);
        const b = rasterizeSilhouette(lod, view, frame);
        let intersection = 0;
        let union = 0;
        for (let index = 0; index < a.length; index++) {
            if (a[index] || b[index]) union += 1;
            if (a[index] && b[index]) intersection += 1;
        }
        scores.push({ view, iou: union ? intersection / union : 1 });
    }
    return scores;
}

function assertAssetPair(sourcePath, sourceStats, lodPath, lodStats, silhouettes) {
    const label = slash(relative(clientRoot, sourcePath));
    const reduction = 1 - lodStats.triangles / sourceStats.triangles;
    if (sourceStats.triangles <= LOW_POLY_SOURCE_LIMIT) {
        invariant(lodStats.triangles <= 12_000, `${label}: low-poly source exception still exceeds 12k`);
        invariant(reduction >= 0.3, `${label}: low-poly source reduction ${(reduction * 100).toFixed(1)}% < 30%`);
    } else {
        invariant(reduction >= MIN_TRIANGLE_REDUCTION, `${label}: triangle reduction ${(reduction * 100).toFixed(1)}% < 60%`);
    }
    invariant(lodStats.triangles <= 15_000, `${label}: ${lodStats.triangles} LOD triangles exceeds 15k`);
    invariant(JSON.stringify(lodStats.skins) === JSON.stringify(sourceStats.skins), `${label}: skeleton/joint identity changed`);
    invariant(JSON.stringify(lodStats.animations) === JSON.stringify(sourceStats.animations), `${label}: animation bank changed`);
    invariant(JSON.stringify(lodStats.materials) === JSON.stringify(sourceStats.materials), `${label}: materials changed`);
    invariant(JSON.stringify(lodStats.attributeSets) === JSON.stringify(sourceStats.attributeSets), `${label}: vertex attribute set changed`);
    invariant(JSON.stringify(lodStats.textures) === JSON.stringify(sourceStats.textures), `${label}: embedded texture payload changed`);
    invariant(lodStats.primitives === lodStats.weightedPrimitives, `${label}: a LOD primitive lost JOINTS_0/WEIGHTS_0`);
    invariant(lodStats.weightRange[0] >= 0.98 && lodStats.weightRange[1] <= 1.02, `${label}: normalized bone weights escaped [0.98, 1.02]`);
    invariant(lodStats.maxJoint < Math.max(...lodStats.skins.map((skin) => skin.joints.length)), `${label}: joint index exceeds skin joint count`);
    for (let axis = 0; axis < 3; axis++) {
        const original = sourceStats.bounds.dimensions[axis];
        const delta = Math.abs(lodStats.bounds.dimensions[axis] - original) / Math.max(1e-6, original);
        invariant(delta <= MAX_BOUNDS_DELTA, `${label}: axis ${axis} bounds changed ${(delta * 100).toFixed(2)}%`);
    }
    for (const score of silhouettes) {
        invariant(score.iou >= MIN_SILHOUETTE_IOU, `${label}: ${score.view} silhouette IoU ${score.iou.toFixed(4)} < ${MIN_SILHOUETTE_IOU}`);
    }
}

function boundsMaxDelta(sourceStats, lodStats) {
    return Math.max(...sourceStats.bounds.dimensions.map((value, axis) =>
        Math.abs(lodStats.bounds.dimensions[axis] - value) / Math.max(1e-6, value)));
}

async function sha256(path) {
    return createHash("sha256").update(await readFile(path)).digest("hex");
}

function outputPathFor(sourcePath) {
    return resolve(outputRoot, relative(modelRoot, sourcePath));
}

async function processAsset(sourcePath) {
    const lodPath = outputPathFor(sourcePath);
    const source = await readDocument(sourcePath);
    const sourceStats = modelStats(source);
    if (!checkOnly) {
        const lowPolySource = sourceStats.triangles <= LOW_POLY_SOURCE_LIMIT;
        let ratio = lowPolySource
            ? Math.min(0.7, 12_000 / sourceStats.triangles)
            : TARGET_LOD_TRIANGLES / sourceStats.triangles;
        const maxRatio = lowPolySource
            ? ratio
            : Math.min(MAX_LOD_TRIANGLES / sourceStats.triangles, 1 - MIN_TRIANGLE_REDUCTION);
        let document;
        while (true) {
            document = await readDocument(sourcePath);
            mergeAccessorBuffers(document);
            skinAwareSimplifyDocument(document, ratio);
            // Optimize the post-transform vertex cache for repeated animated
            // draw performance, not merely transmission size.
            await document.transform(reorder({ encoder: MeshoptEncoder, target: "performance" }));
            const candidateStats = modelStats(document);
            const candidateSilhouettes = silhouetteIoU(source, document, sourceStats.bounds);
            const candidatePasses = Math.min(...candidateSilhouettes.map((score) => score.iou)) >= MIN_SILHOUETTE_IOU
                && boundsMaxDelta(sourceStats, candidateStats) <= MAX_BOUNDS_DELTA;
            if (candidatePasses || ratio >= maxRatio - 1e-8) {
                assertAssetPair(sourcePath, sourceStats, lodPath, candidateStats, candidateSilhouettes);
                break;
            }
            ratio = Math.min(maxRatio, ratio + 0.025);
        }
        await mkdir(dirname(lodPath), { recursive: true });
        await io.write(lodPath, document);
    }
    await stat(lodPath);
    const lod = await readDocument(lodPath);
    const lodStats = modelStats(lod);
    const silhouettes = silhouetteIoU(source, lod, sourceStats.bounds);
    assertAssetPair(sourcePath, sourceStats, lodPath, lodStats, silhouettes);
    const sourceRelative = slash(relative(publicRoot, sourcePath));
    const lodRelative = slash(relative(publicRoot, lodPath));
    const [sourceFile, lodFile, sourceHash, lodHash] = await Promise.all([
        stat(sourcePath),
        stat(lodPath),
        sha256(sourcePath),
        sha256(lodPath),
    ]);
    return {
        sourceUrl: `/${sourceRelative}`,
        lodUrl: `/${lodRelative}?v=${REVISION}`,
        sourceBytes: sourceFile.size,
        lodBytes: lodFile.size,
        sourceSha256: sourceHash,
        lodSha256: lodHash,
        sourceTriangles: sourceStats.triangles,
        lodTriangles: lodStats.triangles,
        reduction: Number((1 - lodStats.triangles / sourceStats.triangles).toFixed(6)),
        lowPolySource: sourceStats.triangles <= LOW_POLY_SOURCE_LIMIT,
        sourceVertices: sourceStats.vertices,
        lodVertices: lodStats.vertices,
        skins: lodStats.skins.length,
        joints: lodStats.skins.reduce((sum, skin) => sum + skin.joints.length, 0),
        animations: lodStats.animations.length,
        materials: lodStats.materials.length,
        textures: lodStats.textures.length,
        boundsMaxDelta: Number(boundsMaxDelta(sourceStats, lodStats).toFixed(6)),
        silhouettes: Object.fromEntries(silhouettes.map((score) => [score.view, Number(score.iou.toFixed(6))])),
    };
}

function manifestTs(entries) {
    const runtime = Object.fromEntries(entries.map((entry) => [entry.sourceUrl, {
        lodUrl: entry.lodUrl,
        sourceTriangles: entry.sourceTriangles,
        lodTriangles: entry.lodTriangles,
    }]));
    return `/* Generated by scripts/generate-warfront-pet-lods.mjs. Do not edit by hand. */\n` +
        `export const WARFRONT_PET_LOD_REVISION = ${JSON.stringify(REVISION)};\n` +
        `export const WARFRONT_PET_LOD_MANIFEST = ${JSON.stringify(runtime, null, 4)} as const;\n` +
        `export type WarfrontPetLodSourceUrl = keyof typeof WARFRONT_PET_LOD_MANIFEST;\n`;
}

const sources = await existingRuntimeSources();
const entries = [];
for (let index = 0; index < sources.length; index++) {
    const entry = await processAsset(sources[index]);
    entries.push(entry);
    if (!quiet) console.log(`[${index + 1}/${sources.length}] ${entry.sourceUrl}: ${entry.sourceTriangles} -> ${entry.lodTriangles} tris, silhouette ${Math.min(...Object.values(entry.silhouettes)).toFixed(4)}`);
}

if (!criticalOnly && !modelFilter) {
    const totals = entries.reduce((value, entry) => ({
        sourceBytes: value.sourceBytes + entry.sourceBytes,
        lodBytes: value.lodBytes + entry.lodBytes,
        sourceTriangles: value.sourceTriangles + entry.sourceTriangles,
        lodTriangles: value.lodTriangles + entry.lodTriangles,
    }), { sourceBytes: 0, lodBytes: 0, sourceTriangles: 0, lodTriangles: 0 });
    const manifest = {
        revision: REVISION,
        generatedBy: "scripts/generate-warfront-pet-lods.mjs",
        policy: {
            targetLodTriangles: TARGET_LOD_TRIANGLES,
            maxLodTriangles: MAX_LOD_TRIANGLES,
            maxError: MAX_ERROR,
            minTriangleReduction: MIN_TRIANGLE_REDUCTION,
            lowPolySourceLimit: LOW_POLY_SOURCE_LIMIT,
            maxBoundsDelta: MAX_BOUNDS_DELTA,
            silhouetteSize: SILHOUETTE_SIZE,
            minSilhouetteIoU: MIN_SILHOUETTE_IOU,
        },
        totals,
        entries,
    };
    if (checkOnly) {
        const checked = JSON.parse(await readFile(jsonManifestPath, "utf8"));
        invariant(checked.revision === REVISION, `Manifest revision ${checked.revision} != ${REVISION}`);
        invariant(checked.entries.length === entries.length, `Manifest has ${checked.entries.length} assets; audit found ${entries.length}`);
        for (const entry of entries) {
            const recorded = checked.entries.find((candidate) => candidate.sourceUrl === entry.sourceUrl);
            invariant(recorded, `${entry.sourceUrl}: absent from manifest`);
            invariant(recorded.sourceSha256 === entry.sourceSha256, `${entry.sourceUrl}: source changed; regenerate LODs`);
            invariant(recorded.lodSha256 === entry.lodSha256, `${entry.sourceUrl}: LOD changed; regenerate manifest`);
        }
    } else {
        await mkdir(dirname(jsonManifestPath), { recursive: true });
        await mkdir(dirname(tsManifestPath), { recursive: true });
        await writeFile(jsonManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await writeFile(tsManifestPath, manifestTs(entries));
    }
    console.log(JSON.stringify({ mode: checkOnly ? "check" : "generate", revision: REVISION, assets: entries.length, totals }, null, 2));
}
