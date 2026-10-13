import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from 'node:crypto';
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { PET_SHOWDOWN_ANIMATION_ASSET_REVISION } from '../src/lib/pet-showdown-animation-assets.ts';

const EXPECTED_CLIPS = [
    'idle', 'idle_2', 'walk', 'gallop', 'gallop_jump', 'attack', 'idle_hitreact1',
    'death', 'entrance', 'cast', 'guard', 'rest', 'victory',
];
const IDENTITY_CLIP_NAMES = new Set(EXPECTED_CLIPS);
const CRITICAL_MOTION_CLIPS = new Set([
    "gallop_jump", "attack", "idle_hitreact1", "death", "entrance", "cast", "guard", "victory",
]);
const clientRoot = resolve(import.meta.dirname, "..");
const modelFilter = process.argv.find(arg => arg.startsWith('--model='))?.slice('--model='.length);
const assetOverride = process.argv.find(arg => arg.startsWith('--asset='))?.slice('--asset='.length);
const assetRoot = process.argv.find(arg => arg.startsWith('--asset-root='))?.slice('--asset-root='.length);
const reportLabel = process.argv.find(arg => arg.startsWith('--label='))?.slice('--label='.length);
const fullGeometry = process.argv.includes('--full-geometry');
const geometryCoverage = fullGeometry ? 'all vertices, triangle edges above numerical degeneracy tolerance, and connected UV seam copies' : 'sampled vertices and triangle edges';
if (assetOverride && !modelFilter) throw new Error('--asset requires --model');
const auditedPetModels = modelFilter
    ? runtimePetModels.filter(({ pet, model }) => modelFilter.split(',').includes(pet.id) || modelFilter.split(',').includes(model.visualId))
    : runtimePetModels;
if (!auditedPetModels.length) throw new Error(`No combat model matches ${modelFilter}`);
const outputRoot = resolve(clientRoot, ".tmp/pet-animation-audit");
const outputPath = resolve(outputRoot, `${modelFilter?.includes(',') ? 'selected-pets' : modelFilter ?? 'all-pet'}${reportLabel ? `-${reportLabel}` : ''}-motion-audit.json`);
function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function texturelessGlb(bytes) {
    const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
    const binary = bytes.subarray(28 + jsonLength);
    json.materials = []; json.textures = []; json.images = [];
    json.meshes.forEach(mesh => mesh.primitives.forEach(primitive => { delete primitive.material; }));
    const text = Buffer.from(JSON.stringify(json)), length = (text.length + 3) & ~3;
    const output = Buffer.alloc(28 + length + binary.length);
    output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(length, 12); output.writeUInt32LE(0x4e4f534a, 16); output.fill(32, 20, 20 + length); text.copy(output, 20);
    output.writeUInt32LE(binary.length, 20 + length); output.writeUInt32LE(0x004e4942, 24 + length); binary.copy(output, 28 + length);
    return output;
}

function prepareEdgeSamples(scene, meshes) {
    scene.updateMatrixWorld(true);
    const plans = [], edges = [];
    let offset = 0;
    for (const mesh of meshes) {
        mesh.skeleton.update();
        const count = mesh.geometry.attributes.position.count;
        const points = Array.from({ length: count }, (_, vertex) => mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
        const diagonal = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length();
        const index = mesh.geometry.index, candidates = new Map();
        for (let triangle = 0; triangle < (index?.count ?? 0); triangle += 3) for (const [from, to] of [[0,1],[1,2],[2,0]]) {
            const a = index.getX(triangle + from), b = index.getX(triangle + to), length = points[a].distanceTo(points[b]);
            if (length > diagonal * (fullGeometry ? 0.000001 : 0.002)) candidates.set(a < b ? a + ',' + b : b + ',' + a, { a, b, length });
        }
        if (fullGeometry) {
            // A UV split duplicates a geometric edge without an indexed edge
            // between its copies. Check those joins explicitly as well. Two
            // coincident vertices must share a neighboring position to count
            // as a surface seam; point contacts between separate parts do not.
            const groups = new Map(), vertexGroups = new Uint32Array(count);
            for (let v = 0; v < count; v++) {
                const position = mesh.geometry.attributes.position;
                const key = [position.getX(v), position.getY(v), position.getZ(v)].map(value => Math.round(value * 1e6)).join(',');
                if (!groups.has(key)) groups.set(key, { id: groups.size, vertices: [] });
                const group = groups.get(key); group.vertices.push(v); vertexGroups[v] = group.id;
            }
            const duplicateNeighbors = new Map();
            for (const { vertices } of groups.values()) if (vertices.length > 1) for (const v of vertices) duplicateNeighbors.set(v, new Set());
            for (let triangle = 0; triangle < (index?.count ?? 0); triangle += 3) {
                const vertices = [index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2)];
                for (const v of vertices) if (duplicateNeighbors.has(v)) for (const n of vertices) if (v !== n && vertexGroups[v] !== vertexGroups[n]) duplicateNeighbors.get(v).add(vertexGroups[n]);
            }
            for (const { vertices } of groups.values()) if (vertices.length > 1) {
                const sharedEdges = new Map();
                for (const v of vertices) for (const neighbor of duplicateNeighbors.get(v)) {
                    if (!sharedEdges.has(neighbor)) sharedEdges.set(neighbor, v);
                    const other = sharedEdges.get(neighbor);
                    if (other !== v) candidates.set(`uv:${Math.min(other, v)},${Math.max(other, v)}`, { a: other, b: v, length: diagonal * 0.000125, uvSeam: true });
                }
            }
        }
        const selected = [...candidates.values()].filter((_, index) => fullGeometry || index % Math.max(1, Math.ceil(candidates.size / 1000)) === 0);
        const ids = new Set();
        for (let vertex = 0; vertex < count; vertex += fullGeometry ? 1 : Math.max(1, Math.ceil(count / 1250))) ids.add(vertex);
        selected.forEach(edge => { ids.add(edge.a); ids.add(edge.b); });
        const vertices = [...ids], lookup = new Map(vertices.map((vertex, index) => [vertex, offset + index]));
        edges.push(...selected.map(edge => ({ a: lookup.get(edge.a), b: lookup.get(edge.b), length: edge.length, uvSeam: edge.uvSeam })));
        const bindPositions = new Float64Array(vertices.length * 3);
        const joints = new Uint32Array(vertices.length * 4), weights = new Float64Array(vertices.length * 4);
        const bindPoint = new THREE.Vector3();
        vertices.forEach((vertex, i) => {
            bindPoint.fromBufferAttribute(mesh.geometry.attributes.position, vertex).applyMatrix4(mesh.bindMatrix).toArray(bindPositions, i * 3);
            for (let slot = 0; slot < 4; slot++) {
                joints[i * 4 + slot] = mesh.geometry.attributes.skinIndex.getComponent(vertex, slot);
                weights[i * 4 + slot] = mesh.geometry.attributes.skinWeight.getComponent(vertex, slot);
            }
        });
        const boneTransforms = mesh.skeleton.bones.map(() => new THREE.Matrix4());
        plans.push({ mesh, vertices, bindPositions, joints, weights, boneTransforms }); offset += vertices.length;
    }
    return { plans, edges };
}

function capturePose(scene) {
    const pose = new Map();
    scene.traverse((object) => {
        pose.set(object.uuid, {
            position: object.position.clone(),
            quaternion: object.quaternion.clone(),
            scale: object.scale.clone(),
        });
    });
    return pose;
}

function restorePose(scene, pose) {
    scene.traverse((object) => {
        const transform = pose.get(object.uuid);
        object.position.copy(transform.position);
        object.quaternion.copy(transform.quaternion);
        object.scale.copy(transform.scale);
    });
}

function sampleSkinnedPoints(scene, plans) {
    scene.updateMatrixWorld(true);
    const points = [];
    for (const { mesh, vertices, bindPositions, joints, weights, boneTransforms } of plans) {
        mesh.skeleton.update();
        // applyBoneTransform otherwise multiplies the same bone matrices again
        // for every influence of every vertex. Cache those Float64 matrices
        // once per pose while preserving Three's exact skinning operations.
        mesh.skeleton.bones.forEach((bone, i) => boneTransforms[i].multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[i]));
        const point = new THREE.Vector3(), base = new THREE.Vector3(), influence = new THREE.Vector3();
        for (let i = 0; i < vertices.length; i++) {
            base.fromArray(bindPositions, i * 3); point.set(0, 0, 0);
            for (let slot = 0; slot < 4; slot++) {
                const weight = weights[i * 4 + slot];
                if (weight !== 0) point.addScaledVector(influence.copy(base).applyMatrix4(boneTransforms[joints[i * 4 + slot]]), weight);
            }
            point.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
            invariant(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), "non-finite skinned vertex");
            points.push(point.clone());
        }
    }
    invariant(points.length > 20, "insufficient skinned geometry samples");
    return points;
}

function measurements(points) {
    const bounds = new THREE.Box3().setFromPoints(points);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    return { bounds, size, center, diagonal: size.length() };
}

function displacementRatio(bindPoints, posedPoints, bindDiagonal) {
    invariant(bindPoints.length === posedPoints.length, "skinned sample count changed between poses");
    let squaredTotal = 0;
    let maximum = 0;
    for (let index = 0; index < bindPoints.length; index += 1) {
        const distance = bindPoints[index].distanceTo(posedPoints[index]);
        squaredTotal += distance * distance;
        maximum = Math.max(maximum, distance);
    }
    return {
        rms: Math.sqrt(squaredTotal / bindPoints.length) / bindDiagonal,
        max: maximum / bindDiagonal,
    };
}

await mkdir(outputRoot, { recursive: true });
await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const report = [];
const identityFingerprints = new Map();
const failures = [];
const deformationWarnings = [];

for (const { pet, model, path: runtimePath, source } of auditedPetModels) {
    try {
        const path = assetOverride ? resolve(assetOverride) : assetRoot ? resolve(assetRoot, relative(resolve(clientRoot, 'public/pet-models'), runtimePath)) : runtimePath;
        const assetBytes = await readFile(path);
        const assetSha256 = createHash('sha256').update(assetBytes).digest('hex');
        const bytes = texturelessGlb(assetBytes);
        const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
        const meshes = [];
        gltf.scene.traverse((object) => {
            if (object instanceof THREE.SkinnedMesh) meshes.push(object);
        });
        invariant(meshes.length > 0, `${pet.id}: skinned mesh missing`);
        const individuallyAuthored = source === "showcase";
        const requiredNames = IDENTITY_CLIP_NAMES;
        const availableNames = new Set(gltf.animations.map((clip) => clip.name));
        invariant(gltf.animations.length === requiredNames.size, `${pet.id}: expected ${requiredNames.size} animation clips`);
        invariant(availableNames.size === requiredNames.size, `${pet.id}: duplicate animation clip names`);
        for (const clipName of requiredNames) invariant(availableNames.has(clipName), `${pet.id}: ${clipName} missing`);
        if (individuallyAuthored) {
            const identity = gltf.parser.json.extras?.showdownAnimationIdentity;
            invariant(gltf.parser.json.extras?.showdownAnimationBank === PET_SHOWDOWN_ANIMATION_ASSET_REVISION, `${pet.id}: stale showcase revision`);
            invariant(gltf.parser.json.extras?.animationAuthoring === "bespoke-species-performance-v3", `${pet.id}: stale showcase authoring`);
            invariant(identity?.key === model.visualId, `${pet.id}: showcase identity key mismatch`);
            invariant(typeof identity?.fingerprint === "string" && /^[A-F0-9]{24}$/u.test(identity.fingerprint), `${pet.id}: showcase fingerprint missing`);
            invariant(!identityFingerprints.has(identity.fingerprint) || identityFingerprints.get(identity.fingerprint) === path, `${pet.id}: duplicate showcase performance fingerprint`);
            identityFingerprints.set(identity.fingerprint, path);
        } else {
            const identity = gltf.parser.json.extras?.properAnimationIdentity;
            invariant(gltf.parser.json.extras?.animationAuthoring === "individual-species-performance-v5", `${pet.id}: stale identity authoring`);
            invariant(typeof identity?.fingerprint === "string" && /^[A-F0-9]{24}$/u.test(identity.fingerprint), `${pet.id}: identity fingerprint missing`);
            invariant(!identityFingerprints.has(identity.fingerprint) || identityFingerprints.get(identity.fingerprint) === path, `${pet.id}: duplicate identity performance fingerprint`);
            identityFingerprints.set(identity.fingerprint, path);
        }

        const { plans, edges } = prepareEdgeSamples(gltf.scene, meshes);
        const bindPose = capturePose(gltf.scene);
        const bindPoints = sampleSkinnedPoints(gltf.scene, plans);
        const bind = measurements(bindPoints);
        invariant(bind.diagonal > 0.01, `${pet.id}: degenerate bind pose`);
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const clips = [];

        for (const clipName of EXPECTED_CLIPS) {
            const take = THREE.AnimationClip.findByName(gltf.animations, clipName);
            invariant(take, `${pet.id}: ${clipName} missing`);
            const times = [...new Set(take.tracks.flatMap(track => [...track.times]))].sort((a, b) => a - b);
            const sampleProgress = [...new Set([...times, ...times.slice(1).map((time, index) => (time + times[index]) / 2)].map(time => Math.min(0.999999, time / take.duration)))].sort((a, b) => a - b);
            const samples = [];
            for (const sample of sampleProgress) {
                mixer.stopAllAction();
                restorePose(gltf.scene, bindPose);
                const action = mixer.clipAction(take);
                action.reset().setLoop(THREE.LoopOnce, 1).play();
                action.time = take.duration * sample;
                mixer.update(0);

                const points = sampleSkinnedPoints(gltf.scene, plans);
                const posed = measurements(points);
                const displacement = displacementRatio(bindPoints, points, bind.diagonal);
                const sizeRatio = posed.diagonal / bind.diagonal;
                const centerShift = posed.center.distanceTo(bind.center) / bind.diagonal;
                invariant(sizeRatio > 0.28 && sizeRatio < 2.8, `${pet.id}/${clipName}@${sample.toFixed(2)}: implausible animated bounds (${sizeRatio.toFixed(3)}x)`);
                invariant(centerShift < 1.6, `${pet.id}/${clipName}@${sample.toFixed(2)}: pose escaped the combat footprint (${centerShift.toFixed(3)}x)`);
                // Native numeric sorting avoids millions of comparator calls
                // during the optional complete-geometry audit. Measure each
                // edge once and retain only the three worst diagnostic edges.
                const ratios = new Float64Array(edges.length), worst = [];
                let severeEdges = 0;
                for (let i = 0; i < edges.length; i++) {
                    const edge = edges[i], length = points[edge.a].distanceTo(points[edge.b]);
                    const ratio = ratios[i] = length / edge.length;
                    if (edge.uvSeam ? length > bind.diagonal * 0.001 : ratio > 8 && length > bind.diagonal * 0.04) {
                        severeEdges++;
                        if (modelFilter || process.argv.includes('--details')) {
                            worst.push({ edge, ratio });
                            worst.sort((a, b) => b.ratio - a.ratio);
                            if (worst.length > 3) worst.pop();
                        }
                    }
                }
                ratios.sort();
                if (severeEdges) {
                    const worstEdges = modelFilter || process.argv.includes('--details') ? worst
                        .map(({ edge, ratio }) => ({
                            vertices: [plans[0]?.vertices[edge.a], plans[0]?.vertices[edge.b]],
                            bindMidpoint: bindPoints[edge.a].clone().add(bindPoints[edge.b]).multiplyScalar(0.5).toArray().map(value => Number(value.toFixed(3))),
                            ratio: Number(ratio.toFixed(3)),
                            ...(edge.uvSeam ? { kind: 'uv-seam' } : {}),
                        })) : undefined;
                    deformationWarnings.push({ id: pet.id, assetId: model.visualId, clip: clipName, progress: Number(sample.toFixed(4)), severeEdges, maximumEdgeStretch: Number(ratios.at(-1).toFixed(3)), ...(worstEdges ? { worstEdges } : {}) });
                }
                samples.push({
                    edgeStretchP99: Number((ratios[Math.floor(ratios.length * 0.99)] ?? 1).toFixed(5)),
                    maximumEdgeStretch: Number((ratios.at(-1) ?? 1).toFixed(5)),
                    severeEdges,
                    progress: Number(sample.toFixed(4)),
                    rmsDisplacement: Number(displacement.rms.toFixed(5)),
                    maxDisplacement: Number(displacement.max.toFixed(5)),
                    sizeRatio: Number(sizeRatio.toFixed(5)),
                    centerShift: Number(centerShift.toFixed(5)),
                });
            }
            if (CRITICAL_MOTION_CLIPS.has(clipName)) {
                invariant(Math.max(...samples.map((sample) => sample.maxDisplacement)) > 0.006, `${pet.id}/${clipName}: authored take has no visible deformation`);
            }
            clips.push({
                name: clipName,
                duration: Number(take.duration.toFixed(4)),
                samples,
            });
        }

        report.push({
            id: pet.id,
            name: pet.name,
            assetId: model.visualId,
            runtimeUrl: model.url,
            source: individuallyAuthored ? "showcase" : "identity",
            rig: gltf.parser.json.extras?.properAnimationRig ?? "individual",
            family: gltf.parser.json.extras?.properAnimationFamily ?? "individual",
            sampledVertices: bindPoints.length,
            sampledEdges: edges.length,
            geometryCoverage,
            assetSha256,
            clips,
        });
        mixer.stopAllAction();
        gltf.scene.traverse(object => { if (object.isMesh) { object.geometry.dispose(); for (const material of [].concat(object.material)) material.dispose(); } });
    } catch (error) { failures.push({ id: pet.id, assetId: model.visualId, runtimeUrl: model.url, error: error.message }); }
    if ((report.length + failures.length) % 20 === 0) console.log('Audited ' + (report.length + failures.length) + '/' + auditedPetModels.length + ' pet identities; deformation warnings: ' + deformationWarnings.length);
}

const summary = {
    geometryCoverage,
    attemptedModels: auditedPetModels.length,
    auditedModels: report.length,
    distinctRuntimeAssets: new Set(auditedPetModels.map(entry => entry.path)).size,
    failedModels: failures.length,
    deformationWarnings: deformationWarnings.length,
    petsWithDeformationWarnings: new Set(deformationWarnings.map(entry => entry.id)).size,
    auditedPoses: report.reduce((total, pet) => total + pet.clips.reduce((subtotal, clip) => subtotal + clip.samples.length, 0), 0),
    showcaseAuthored: report.filter((pet) => pet.source === "showcase").length,
    identityAuthored: report.filter((pet) => pet.source === "identity").length,
    identityDirected: report.length,
    uniquePerformanceFingerprints: identityFingerprints.size,
    rigs: [...new Set(report.map((pet) => pet.rig))].sort(),
    families: [...new Set(report.map((pet) => pet.family))].sort(),
};
await writeFile(outputPath, `${JSON.stringify({ summary, failures, deformationWarnings, pets: report }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${outputPath}`);

if (failures.length || deformationWarnings.length) process.exitCode = 1;
