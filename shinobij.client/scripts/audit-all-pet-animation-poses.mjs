import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { rawPetPool } from "../src/data/pet-pool.ts";
import { STARTER_PETS } from "../src/data/starter-pets.ts";
import { STARTER_EVOLUTIONS } from "../src/data/pet-evolutions.ts";
import { INDIVIDUAL_PET_ANIMATION_MODEL_IDS } from "../src/lib/pet-proper-animation-assets.ts";

globalThis.self = globalThis;

const EXPECTED_CLIPS = [
    ["idle", 0.32],
    ["idle_2", 0.42],
    ["walk", 0.28],
    ["gallop", 0.48],
    ["gallop_jump", 0.42],
    ["attack", 0.53],
    ["idle_hitreact1", 0.16],
    ["death", 0.9],
];
const CRITICAL_MOTION_CLIPS = new Set(["gallop_jump", "attack", "idle_hitreact1", "death"]);
const clientRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(clientRoot, ".tmp/pet-animation-audit");
const outputPath = resolve(outputRoot, "all-pet-motion-audit.json");
const catalog = [
    ...rawPetPool,
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function assetPath(id) {
    if (INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(id)) {
        return resolve(clientRoot, `public/pet-models/showdown-v2/${id}.glb`);
    }
    return id.startsWith("starter-")
        ? resolve(clientRoot, `public/pet-models/${id}.glb`)
        : resolve(clientRoot, `public/pet-models/roster/${id}.glb`);
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

function sampleSkinnedPoints(scene, meshes) {
    scene.updateMatrixWorld(true);
    const points = [];
    for (const mesh of meshes) {
        mesh.skeleton.update();
        const positions = mesh.geometry.getAttribute("position");
        const point = new THREE.Vector3();
        const stride = Math.max(1, Math.ceil(positions.count / 1_250));
        for (let index = 0; index < positions.count; index += stride) {
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

invariant(catalog.length === 160, `expected 160 production pets, found ${catalog.length}`);
invariant(new Set(catalog.map((pet) => pet.id)).size === 160, "production pet ids must be unique");
await mkdir(outputRoot, { recursive: true });
await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const report = [];

for (const pet of catalog) {
    const path = assetPath(pet.id);
    const bytes = await readFile(path);
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const meshes = [];
    gltf.scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    invariant(meshes.length > 0, `${pet.id}: skinned mesh missing`);
    invariant(gltf.animations.length === EXPECTED_CLIPS.length, `${pet.id}: expected eight animation clips`);

    const bindPose = capturePose(gltf.scene);
    const bindPoints = sampleSkinnedPoints(gltf.scene, meshes);
    const bind = measurements(bindPoints);
    invariant(bind.diagonal > 0.01, `${pet.id}: degenerate bind pose`);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clips = [];

    for (const [clipName, progress] of EXPECTED_CLIPS) {
        mixer.stopAllAction();
        restorePose(gltf.scene, bindPose);
        const take = THREE.AnimationClip.findByName(gltf.animations, clipName);
        invariant(take, `${pet.id}: ${clipName} missing`);
        const action = mixer.clipAction(take);
        action.reset().setLoop(THREE.LoopOnce, 1).play();
        action.time = take.duration * progress;
        mixer.update(0);

        const points = sampleSkinnedPoints(gltf.scene, meshes);
        const posed = measurements(points);
        const displacement = displacementRatio(bindPoints, points, bind.diagonal);
        const sizeRatio = posed.diagonal / bind.diagonal;
        const centerShift = posed.center.distanceTo(bind.center) / bind.diagonal;
        invariant(sizeRatio > 0.28 && sizeRatio < 2.8, `${pet.id}/${clipName}: implausible animated bounds (${sizeRatio.toFixed(3)}x)`);
        invariant(centerShift < 1.6, `${pet.id}/${clipName}: pose escaped the combat footprint (${centerShift.toFixed(3)}x)`);
        if (CRITICAL_MOTION_CLIPS.has(clipName)) {
            invariant(displacement.max > 0.006, `${pet.id}/${clipName}: authored pose has no visible deformation`);
        }
        clips.push({
            name: clipName,
            duration: Number(take.duration.toFixed(4)),
            rmsDisplacement: Number(displacement.rms.toFixed(5)),
            maxDisplacement: Number(displacement.max.toFixed(5)),
            sizeRatio: Number(sizeRatio.toFixed(5)),
            centerShift: Number(centerShift.toFixed(5)),
        });
    }

    report.push({
        id: pet.id,
        name: pet.name,
        source: INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(pet.id) ? "individual" : "family",
        rig: gltf.parser.json.extras?.properAnimationRig ?? "individual",
        family: gltf.parser.json.extras?.properAnimationFamily ?? "individual",
        sampledVertices: bindPoints.length,
        clips,
    });
    mixer.stopAllAction();
}

const summary = {
    auditedModels: report.length,
    auditedPoses: report.reduce((total, pet) => total + pet.clips.length, 0),
    individuallyAuthored: report.filter((pet) => pet.source === "individual").length,
    familyAuthored: report.filter((pet) => pet.source === "family").length,
    rigs: [...new Set(report.map((pet) => pet.rig))].sort(),
    families: [...new Set(report.map((pet) => pet.family))].sort(),
};
await writeFile(outputPath, `${JSON.stringify({ summary, pets: report }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${outputPath}`);
