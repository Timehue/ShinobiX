import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
const outputRoot = resolve(clientRoot, ".tmp/pet-animation-audit");
const outputPath = resolve(outputRoot, "all-pet-motion-audit.json");
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
            if (length > diagonal * 0.002) candidates.set(a < b ? a + ',' + b : b + ',' + a, { a, b, length });
        }
        const selected = [...candidates.values()].filter((_, index) => index % Math.max(1, Math.ceil(candidates.size / 1000)) === 0);
        const ids = new Set();
        for (let vertex = 0; vertex < count; vertex += Math.max(1, Math.ceil(count / 1250))) ids.add(vertex);
        selected.forEach(edge => { ids.add(edge.a); ids.add(edge.b); });
        const vertices = [...ids], lookup = new Map(vertices.map((vertex, index) => [vertex, offset + index]));
        edges.push(...selected.map(edge => ({ a: lookup.get(edge.a), b: lookup.get(edge.b), length: edge.length })));
        plans.push({ mesh, vertices }); offset += vertices.length;
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
    for (const { mesh, vertices } of plans) {
        mesh.skeleton.update();
        const positions = mesh.geometry.getAttribute("position");
        const point = new THREE.Vector3();
        for (const index of vertices) {
            point.fromBufferAttribute(positions, index);
            mesh.applyBoneTransform(index, point);
            point.applyMatrix4(mesh.matrixWorld);
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

for (const { pet, model, path, source } of runtimePetModels) {
    try {
        const bytes = texturelessGlb(await readFile(path));
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
                const ratios = edges.map(edge => points[edge.a].distanceTo(points[edge.b]) / edge.length).sort((a, b) => a - b);
                const severeEdges = edges.filter(edge => {
                    const length = points[edge.a].distanceTo(points[edge.b]);
                    return length / edge.length > 8 && length > bind.diagonal * 0.04;
                }).length;
                if (severeEdges) deformationWarnings.push({ id: pet.id, assetId: model.visualId, clip: clipName, progress: Number(sample.toFixed(4)), severeEdges, maximumEdgeStretch: Number(ratios.at(-1).toFixed(3)) });
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
            clips,
        });
        mixer.stopAllAction();
        gltf.scene.traverse(object => { if (object.isMesh) { object.geometry.dispose(); for (const material of [].concat(object.material)) material.dispose(); } });
    } catch (error) { failures.push({ id: pet.id, assetId: model.visualId, runtimeUrl: model.url, error: error.message }); }
    if ((report.length + failures.length) % 20 === 0) console.log('Audited ' + (report.length + failures.length) + '/160 pet identities');
}

const summary = {
    attemptedModels: runtimePetModels.length,
    auditedModels: report.length,
    distinctRuntimeAssets: new Set(runtimePetModels.map(entry => entry.path)).size,
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
