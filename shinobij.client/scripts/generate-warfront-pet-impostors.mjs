/**
 * Generate deterministic, animated Warfront impostor atlases from the
 * certified battle LOD GLBs. The ordinary 3D assets remain untouched.
 *
 * Usage:
 *   node scripts/generate-warfront-pet-impostors.mjs --critical-only
 *   node scripts/generate-warfront-pet-impostors.mjs --critical-only --check
 *   node scripts/generate-warfront-pet-impostors.mjs
 *   node scripts/generate-warfront-pet-impostors.mjs --check
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import {
    AnimationMixer,
    Texture,
    TextureLoader,
    Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(clientRoot, "public");
const lodRoot = resolve(publicRoot, "pet-models/warfront-lod");
const outputRoot = resolve(publicRoot, "pet-models/warfront-impostors");
const lodManifestPath = resolve(lodRoot, "manifest.json");
const jsonManifestPath = resolve(outputRoot, "manifest.json");
const tsManifestPath = resolve(clientRoot, "src/generated/pet-warfront-impostor-manifest.ts");

const REVISION = "20260902-warfront-impostor-v1";
const EXPECTED_SOURCE_COUNT = 159;
const CELL_SIZE = 128;
const COLUMNS = 4;
const ROWS = 4;
const ATLAS_WIDTH = CELL_SIZE * COLUMNS;
const ATLAS_HEIGHT = CELL_SIZE * ROWS;
const TEXTURE_SAMPLE_SIZE = 512;
const FRAME_PADDING = 7;
const OUTLINE_RADIUS = 1;
const MIN_OCCUPIED_PIXELS = 320;

const FRAMES = Object.freeze([
    { clip: "idle", progress: 0.1 },
    { clip: "idle", progress: 0.35 },
    { clip: "idle", progress: 0.6 },
    { clip: "idle", progress: 0.85 },
    { clip: "walk", progress: 0.2 },
    { clip: "walk", progress: 0.7 },
    { clip: "gallop", progress: 0.2 },
    { clip: "gallop", progress: 0.7 },
    { clip: "attack", progress: 0.2 },
    { clip: "attack", progress: 0.5 },
    { clip: "attack", progress: 0.8 },
    { clip: "idle_hitreact1", progress: 0.35 },
    { clip: "death", progress: 0.25 },
    { clip: "death", progress: 0.6 },
    { clip: "death", progress: 0.95 },
    { clip: "cast", progress: 0.55 },
]);

const CRITICAL_SOURCE_URLS = new Set([
    "/pet-models/roster/mythic-0.glb",
    "/pet-models/roster/mythic-2.glb",
    "/pet-models/roster/mythic-3.glb",
    "/pet-models/roster/mythic-4.glb",
]);

const argv = new Set(process.argv.slice(2));
const checkOnly = argv.has("--check");
const criticalOnly = argv.has("--critical-only");
const quiet = argv.has("--quiet");
const modelFilter = process.argv.slice(2).find((arg) => arg.startsWith("--model="))?.slice(8);

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function slash(path) {
    return path.split(sep).join("/");
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function round(value, places = 6) {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

function edge(ax, ay, bx, by, px, py) {
    return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

// GLTFLoader is used for its exact Three.js animation and skinning semantics.
// The CPU rasterizer reads the embedded atlas separately with sharp, so replace
// browser-only image loading with a harmless placeholder texture in Node.
globalThis.self ??= globalThis;
TextureLoader.prototype.load = function loadOfflineTexture(_url, onLoad) {
    const texture = new Texture();
    texture.flipY = false;
    queueMicrotask(() => onLoad?.(texture));
    return texture;
};

await MeshoptDecoder.ready;
const documentIo = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function loadThreeGltf(path) {
    const bytes = await readFile(path);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Promise((resolvePromise, rejectPromise) => {
        gltfLoader.parse(arrayBuffer, "", resolvePromise, rejectPromise);
    });
}

async function loadTexture(path) {
    const document = await documentIo.read(path);
    const materials = document.getRoot().listMaterials();
    invariant(materials.length === 1, `${path}: expected one material, found ${materials.length}`);
    const material = materials[0];
    const texture = material.getBaseColorTexture();
    invariant(texture?.getImage(), `${path}: missing embedded base-colour texture`);
    const decoded = await sharp(texture.getImage(), { failOn: "error" })
        .resize(TEXTURE_SAMPLE_SIZE, TEXTURE_SAMPLE_SIZE, { fit: "fill", kernel: "lanczos3" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return {
        pixels: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        factor: material.getBaseColorFactor(),
    };
}

function collectMeshDescriptors(scene) {
    const descriptors = [];
    scene.traverse((object) => {
        if (!object.isMesh) return;
        const position = object.geometry.getAttribute("position");
        const uv = object.geometry.getAttribute("uv");
        invariant(position && uv, `${object.name}: impostor input needs POSITION and TEXCOORD_0`);
        const indices = object.geometry.getIndex();
        invariant(indices, `${object.name}: impostor input must be indexed`);
        const uvs = new Float32Array(uv.count * 2);
        for (let index = 0; index < uv.count; index++) {
            uvs[index * 2] = uv.getX(index);
            uvs[index * 2 + 1] = uv.getY(index);
        }
        descriptors.push({ object, position, indices: indices.array, uvs });
    });
    invariant(descriptors.length > 0, "GLB has no rasterizable meshes");
    return descriptors;
}

function sampleAnimatedFrame(scene, mixer, clip, progress, descriptors) {
    mixer.stopAllAction();
    mixer.time = 0;
    const action = mixer.clipAction(clip);
    action.reset().setEffectiveWeight(1).play();
    mixer.update(clip.duration * progress);
    scene.updateMatrixWorld(true);
    scene.traverse((object) => object.isSkinnedMesh && object.skeleton.update());

    const sampled = [];
    const point = new Vector3();
    for (const descriptor of descriptors) {
        const { object, position } = descriptor;
        const positions = new Float32Array(position.count * 3);
        for (let vertex = 0; vertex < position.count; vertex++) {
            object.getVertexPosition(vertex, point);
            point.applyMatrix4(object.matrixWorld);
            positions[vertex * 3] = point.x;
            positions[vertex * 3 + 1] = point.y;
            positions[vertex * 3 + 2] = point.z;
        }
        sampled.push(positions);
    }
    return sampled;
}

const cameraTowardViewer = new Vector3(1, 0.72, 0.34).normalize();
const screenRight = new Vector3().crossVectors(new Vector3(0, 1, 0), cameraTowardViewer).normalize();
const screenUp = new Vector3().crossVectors(cameraTowardViewer, screenRight).normalize();
const lightDirection = new Vector3(0.35, 0.9, 0.48).normalize();

function projectedFrame(samples) {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const frame of samples) for (const positions of frame) {
        for (let offset = 0; offset < positions.length; offset += 3) {
            const x = positions[offset];
            const y = positions[offset + 1];
            const z = positions[offset + 2];
            const u = x * screenRight.x + y * screenRight.y + z * screenRight.z;
            const v = x * screenUp.x + y * screenUp.y + z * screenUp.z;
            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
        }
    }
    invariant(Number.isFinite(minU) && maxU > minU && maxV > minV, "animated model has invalid projected bounds");
    const width = maxU - minU;
    const height = maxV - minV;
    const available = CELL_SIZE - FRAME_PADDING * 2;
    return {
        centerU: (minU + maxU) / 2,
        centerV: (minV + maxV) / 2,
        scale: Math.min(available / width, available / height),
        projectedWidth: width,
        projectedHeight: height,
    };
}

function wrap01(value) {
    return value - Math.floor(value);
}

function textureSample(texture, u, v, shade, output, offset) {
    const x = wrap01(u) * (texture.width - 1);
    const y = wrap01(v) * (texture.height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % texture.width;
    const y1 = (y0 + 1) % texture.height;
    const tx = x - x0;
    const ty = y - y0;
    const sample = (sx, sy, channel) => texture.pixels[(sy * texture.width + sx) * 4 + channel];
    for (let channel = 0; channel < 4; channel++) {
        const top = sample(x0, y0, channel) * (1 - tx) + sample(x1, y0, channel) * tx;
        const bottom = sample(x0, y1, channel) * (1 - tx) + sample(x1, y1, channel) * tx;
        const value = top * (1 - ty) + bottom * ty;
        output[offset + channel] = Math.max(0, Math.min(255, Math.round(
            value * texture.factor[channel] * (channel === 3 ? 1 : shade),
        )));
    }
}

function outlineCell(cell) {
    const source = Buffer.from(cell);
    for (let y = 0; y < CELL_SIZE; y++) for (let x = 0; x < CELL_SIZE; x++) {
        const offset = (y * CELL_SIZE + x) * 4;
        if (source[offset + 3] > 0) continue;
        let neighborAlpha = 0;
        for (let dy = -OUTLINE_RADIUS; dy <= OUTLINE_RADIUS; dy++) {
            const sy = y + dy;
            if (sy < 0 || sy >= CELL_SIZE) continue;
            for (let dx = -OUTLINE_RADIUS; dx <= OUTLINE_RADIUS; dx++) {
                const sx = x + dx;
                if (sx < 0 || sx >= CELL_SIZE || (dx === 0 && dy === 0)) continue;
                neighborAlpha = Math.max(neighborAlpha, source[(sy * CELL_SIZE + sx) * 4 + 3]);
            }
        }
        if (neighborAlpha > 0) {
            cell[offset] = 19;
            cell[offset + 1] = 22;
            cell[offset + 2] = 28;
            cell[offset + 3] = Math.min(210, neighborAlpha);
        }
    }
}

function rasterizeFrame(descriptors, sampled, frame) {
    const cell = Buffer.alloc(CELL_SIZE * CELL_SIZE * 4);
    const depth = new Float32Array(CELL_SIZE * CELL_SIZE);
    depth.fill(-Infinity);
    let triangles = 0;
    for (let meshIndex = 0; meshIndex < descriptors.length; meshIndex++) {
        const descriptor = descriptors[meshIndex];
        const positions = sampled[meshIndex];
        const count = positions.length / 3;
        const projected = new Float32Array(count * 3);
        for (let vertex = 0; vertex < count; vertex++) {
            const x = positions[vertex * 3];
            const y = positions[vertex * 3 + 1];
            const z = positions[vertex * 3 + 2];
            const u = x * screenRight.x + y * screenRight.y + z * screenRight.z;
            const v = x * screenUp.x + y * screenUp.y + z * screenUp.z;
            projected[vertex * 3] = (u - frame.centerU) * frame.scale + CELL_SIZE / 2;
            projected[vertex * 3 + 1] = CELL_SIZE / 2 - (v - frame.centerV) * frame.scale;
            projected[vertex * 3 + 2] = x * cameraTowardViewer.x + y * cameraTowardViewer.y + z * cameraTowardViewer.z;
        }
        const indices = descriptor.indices;
        for (let indexOffset = 0; indexOffset + 2 < indices.length; indexOffset += 3) {
            const ia = Number(indices[indexOffset]);
            const ib = Number(indices[indexOffset + 1]);
            const ic = Number(indices[indexOffset + 2]);
            const ax = projected[ia * 3];
            const ay = projected[ia * 3 + 1];
            const bx = projected[ib * 3];
            const by = projected[ib * 3 + 1];
            const cx = projected[ic * 3];
            const cy = projected[ic * 3 + 1];
            const area = edge(ax, ay, bx, by, cx, cy);
            if (Math.abs(area) < 1e-7) continue;
            triangles++;
            const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
            const maxX = Math.min(CELL_SIZE - 1, Math.ceil(Math.max(ax, bx, cx)));
            const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
            const maxY = Math.min(CELL_SIZE - 1, Math.ceil(Math.max(ay, by, cy)));
            if (minX > maxX || minY > maxY) continue;

            const abx = positions[ib * 3] - positions[ia * 3];
            const aby = positions[ib * 3 + 1] - positions[ia * 3 + 1];
            const abz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
            const acx = positions[ic * 3] - positions[ia * 3];
            const acy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
            const acz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
            let nx = aby * acz - abz * acy;
            let ny = abz * acx - abx * acz;
            let nz = abx * acy - aby * acx;
            const normalLength = Math.hypot(nx, ny, nz) || 1;
            nx /= normalLength;
            ny /= normalLength;
            nz /= normalLength;
            if (nx * cameraTowardViewer.x + ny * cameraTowardViewer.y + nz * cameraTowardViewer.z < 0) {
                nx *= -1;
                ny *= -1;
                nz *= -1;
            }
            const shade = 0.68 + 0.32 * Math.max(0, nx * lightDirection.x + ny * lightDirection.y + nz * lightDirection.z);
            const inverseArea = 1 / area;
            for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5;
                const py = y + 0.5;
                const wa = edge(bx, by, cx, cy, px, py) * inverseArea;
                const wb = edge(cx, cy, ax, ay, px, py) * inverseArea;
                const wc = 1 - wa - wb;
                if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
                const pixel = y * CELL_SIZE + x;
                const z = wa * projected[ia * 3 + 2] + wb * projected[ib * 3 + 2] + wc * projected[ic * 3 + 2];
                if (z <= depth[pixel]) continue;
                const u = wa * descriptor.uvs[ia * 2] + wb * descriptor.uvs[ib * 2] + wc * descriptor.uvs[ic * 2];
                const v = wa * descriptor.uvs[ia * 2 + 1] + wb * descriptor.uvs[ib * 2 + 1] + wc * descriptor.uvs[ic * 2 + 1];
                textureSample(currentTexture, u, v, shade, cell, pixel * 4);
                if (cell[pixel * 4 + 3] > 0) depth[pixel] = z;
            }
        }
    }
    outlineCell(cell);
    let occupiedPixels = 0;
    for (let offset = 3; offset < cell.length; offset += 4) occupiedPixels += cell[offset] > 0 ? 1 : 0;
    invariant(occupiedPixels >= MIN_OCCUPIED_PIXELS, `frame raster is too sparse (${occupiedPixels} pixels)`);
    return { cell, triangles, occupiedPixels };
}

let currentTexture;

async function buildAtlas(lodPath) {
    const [gltf, texture] = await Promise.all([loadThreeGltf(lodPath), loadTexture(lodPath)]);
    currentTexture = texture;
    const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
    for (const frame of FRAMES) invariant(clips.has(frame.clip), `${lodPath}: missing authored clip ${frame.clip}`);
    const descriptors = collectMeshDescriptors(gltf.scene);
    const mixer = new AnimationMixer(gltf.scene);
    const samples = FRAMES.map((frame) => sampleAnimatedFrame(
        gltf.scene,
        mixer,
        clips.get(frame.clip),
        frame.progress,
        descriptors,
    ));
    const frame = projectedFrame(samples);
    const atlas = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
    const occupiedPixels = [];
    let trianglesPerFrame = 0;
    for (let frameIndex = 0; frameIndex < FRAMES.length; frameIndex++) {
        const raster = rasterizeFrame(descriptors, samples[frameIndex], frame);
        trianglesPerFrame = Math.max(trianglesPerFrame, raster.triangles);
        occupiedPixels.push(raster.occupiedPixels);
        const cellX = frameIndex % COLUMNS;
        const cellY = Math.floor(frameIndex / COLUMNS);
        for (let row = 0; row < CELL_SIZE; row++) {
            const sourceStart = row * CELL_SIZE * 4;
            const targetStart = ((cellY * CELL_SIZE + row) * ATLAS_WIDTH + cellX * CELL_SIZE) * 4;
            raster.cell.copy(atlas, targetStart, sourceStart, sourceStart + CELL_SIZE * 4);
        }
    }
    mixer.stopAllAction();
    const webp = await sharp(atlas, { raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4 } })
        .webp({ lossless: true, effort: 6 })
        .toBuffer();
    const webpMetadata = await sharp(webp).metadata();
    invariant(
        webpMetadata.width === ATLAS_WIDTH
            && webpMetadata.height === ATLAS_HEIGHT
            && webpMetadata.hasAlpha,
        `encoded atlas lost its ${ATLAS_WIDTH}x${ATLAS_HEIGHT} alpha surface`,
    );
    const durationByClip = Object.fromEntries(
        [...new Set(FRAMES.map((item) => item.clip))].map((name) => [name, round(clips.get(name).duration)]),
    );
    return {
        webp,
        durationByClip,
        frameTimesSeconds: FRAMES.map((item) => round(clips.get(item.clip).duration * item.progress)),
        occupiedPixels,
        trianglesPerFrame,
        projectedAspect: round(frame.projectedWidth / frame.projectedHeight),
    };
}

function atlasPaths(sourceUrl) {
    invariant(sourceUrl.startsWith("/pet-models/") && !sourceUrl.includes("?"), `invalid source URL ${sourceUrl}`);
    const relativePath = sourceUrl.slice("/pet-models/".length).replace(/\.glb$/u, ".webp");
    invariant(relativePath.endsWith(".webp"), `source URL is not a GLB: ${sourceUrl}`);
    return {
        path: resolve(outputRoot, relativePath),
        url: `/pet-models/warfront-impostors/${slash(relativePath)}`,
    };
}

function lodPathFromUrl(lodUrl) {
    const pathname = new URL(lodUrl, "https://offline.invalid").pathname;
    const prefix = "/pet-models/warfront-lod/";
    invariant(pathname.startsWith(prefix), `LOD URL is outside certified bank: ${lodUrl}`);
    return resolve(lodRoot, pathname.slice(prefix.length));
}

async function writeStable(path, bytes) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
}

function tsManifest(entries) {
    const runtime = Object.fromEntries(entries.map((entry) => [entry.sourceUrl, {
        atlasUrl: entry.atlasUrl,
        width: entry.width,
        height: entry.height,
        columns: entry.columns,
        rows: entry.rows,
        frames: entry.frames,
    }]));
    return `/** Generated by scripts/generate-warfront-pet-impostors.mjs. Do not edit. */\nexport const WARFRONT_IMPOSTOR_MANIFEST = ${JSON.stringify(runtime, null, 4)} as const;\nexport type WarfrontImpostorSourceUrl = keyof typeof WARFRONT_IMPOSTOR_MANIFEST;\n`;
}

const lodManifest = JSON.parse(await readFile(lodManifestPath, "utf8"));
invariant(lodManifest.entries?.length === EXPECTED_SOURCE_COUNT, `expected ${EXPECTED_SOURCE_COUNT} certified LODs, found ${lodManifest.entries?.length ?? 0}`);
let selected = [...lodManifest.entries].sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
if (criticalOnly) selected = selected.filter((entry) => CRITICAL_SOURCE_URLS.has(entry.sourceUrl));
if (modelFilter) selected = selected.filter((entry) => entry.sourceUrl.endsWith(`/${modelFilter}.glb`));
invariant(selected.length > 0, "no Warfront LOD inputs selected");
if (criticalOnly && !modelFilter) invariant(selected.length === CRITICAL_SOURCE_URLS.size, "critical LOD inventory is incomplete");

const results = [];
const startedAt = performance.now();
for (const [index, source] of selected.entries()) {
    const lodPath = lodPathFromUrl(source.lodUrl);
    const lodBytes = await readFile(lodPath);
    invariant(sha256(lodBytes) === source.lodSha256, `${source.sourceUrl}: certified LOD hash changed`);
    const built = await buildAtlas(lodPath);
    const output = atlasPaths(source.sourceUrl);
    const result = {
        sourceUrl: source.sourceUrl,
        lodUrl: source.lodUrl,
        lodSha256: source.lodSha256,
        atlasUrl: output.url,
        atlasSha256: sha256(built.webp),
        atlasBytes: built.webp.byteLength,
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        columns: COLUMNS,
        rows: ROWS,
        cellWidth: CELL_SIZE,
        cellHeight: CELL_SIZE,
        frames: FRAMES,
        frameTimesSeconds: built.frameTimesSeconds,
        clipDurationsSeconds: built.durationByClip,
        occupiedPixels: built.occupiedPixels,
        trianglesPerFrame: built.trianglesPerFrame,
        projectedAspect: built.projectedAspect,
    };
    if (checkOnly) {
        const existing = await readFile(output.path);
        invariant(existing.equals(built.webp), `${source.sourceUrl}: atlas is stale or non-reproducible`);
    } else {
        await writeStable(output.path, built.webp);
    }
    results.push(result);
    if (!quiet) console.log(`[${index + 1}/${selected.length}] ${source.sourceUrl} -> ${output.url} (${built.webp.byteLength} bytes)`);
}

const manifest = {
    revision: REVISION,
    generatedBy: "scripts/generate-warfront-pet-impostors.mjs",
    sourceLodRevision: lodManifest.revision,
    policy: {
        format: "lossless-webp",
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        columns: COLUMNS,
        rows: ROWS,
        cellSize: CELL_SIZE,
        framePadding: FRAME_PADDING,
        textureSampleSize: TEXTURE_SAMPLE_SIZE,
        outlineRadius: OUTLINE_RADIUS,
        viewTowardViewer: cameraTowardViewer.toArray().map((value) => round(value)),
        frames: FRAMES,
    },
    selectedCount: results.length,
    complete: results.length === EXPECTED_SOURCE_COUNT,
    entries: results,
};
const jsonBytes = `${JSON.stringify(manifest, null, 2)}\n`;
const tsBytes = tsManifest(results);
if (checkOnly) {
    const existingJsonBytes = await readFile(jsonManifestPath, "utf8");
    const existingManifest = JSON.parse(existingJsonBytes);
    if (results.length === EXPECTED_SOURCE_COUNT) {
        invariant(existingJsonBytes === jsonBytes, "JSON impostor manifest is stale");
        invariant(await readFile(tsManifestPath, "utf8") === tsBytes, "TypeScript impostor manifest is stale");
    } else {
        const existingBySource = new Map(existingManifest.entries?.map((entry) => [entry.sourceUrl, entry]));
        for (const result of results) {
            invariant(
                JSON.stringify(existingBySource.get(result.sourceUrl)) === JSON.stringify(result),
                `${result.sourceUrl}: manifest entry is missing or stale`,
            );
        }
        invariant(
            await readFile(tsManifestPath, "utf8") === tsManifest(existingManifest.entries ?? []),
            "TypeScript impostor manifest is not synchronized with JSON",
        );
    }
} else {
    await writeStable(jsonManifestPath, jsonBytes);
    await writeStable(tsManifestPath, tsBytes);
}

if (!quiet) {
    const totalBytes = results.reduce((sum, entry) => sum + entry.atlasBytes, 0);
    console.log(`${checkOnly ? "Certified" : "Generated"} ${results.length} deterministic Warfront impostor atlases (${totalBytes} bytes) in ${round((performance.now() - startedAt) / 1000, 2)}s.`);
}
