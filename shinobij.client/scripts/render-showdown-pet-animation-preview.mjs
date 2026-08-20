import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

globalThis.self = globalThis;

const PET_IDS = ["rare-1", "standard-7", "starter-fire-l", "starter-lightning-l"];
const SAMPLES = [
    ["idle", 0.32],
    ["idle_2", 0.42],
    ["walk", 0.28],
    ["gallop", 0.48],
    ["gallop_jump", 0.42],
    ["attack", 0.53],
    ["idle_hitreact1", 0.16],
    ["death", 0.9],
];
const clientRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(clientRoot, ".tmp/showdown-animation-qa");
await mkdir(outputRoot, { recursive: true });
await MeshoptDecoder.ready;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const outputs = [];

for (const id of PET_IDS) {
    const path = resolve(clientRoot, `public/pet-models/showdown-v2/${id}.glb`);
    const bytes = await readFile(path);
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const meshes = [];
    gltf.scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    if (!meshes.length) throw new Error(`${id}: skinned mesh missing`);

    const bind = new Map();
    gltf.scene.traverse((object) => {
        bind.set(object.uuid, {
            position: object.position.clone(),
            quaternion: object.quaternion.clone(),
            scale: object.scale.clone(),
        });
    });
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const panels = [];

    for (const [clipName, progress] of SAMPLES) {
        mixer.stopAllAction();
        gltf.scene.traverse((object) => {
            const pose = bind.get(object.uuid);
            object.position.copy(pose.position);
            object.quaternion.copy(pose.quaternion);
            object.scale.copy(pose.scale);
        });
        const take = THREE.AnimationClip.findByName(gltf.animations, clipName);
        if (!take) throw new Error(`${id}: ${clipName} missing`);
        const action = mixer.clipAction(take);
        action.reset().setLoop(THREE.LoopOnce, 1).play();
        action.time = take.duration * progress;
        mixer.update(0);
        gltf.scene.updateMatrixWorld(true);

        const points = [];
        for (const mesh of meshes) {
            mesh.skeleton.update();
            const positions = mesh.geometry.getAttribute("position");
            const point = new THREE.Vector3();
            const stride = Math.max(1, Math.ceil(positions.count / 5_200));
            for (let index = 0; index < positions.count; index += stride) {
                point.fromBufferAttribute(positions, index);
                mesh.applyBoneTransform(index, point);
                point.applyMatrix4(mesh.matrixWorld);
                points.push(point.clone());
            }
        }
        panels.push({ clipName, points });
    }

    const allProjected = panels.flatMap((panel) => panel.points.map((point) => [point.x - point.z * 0.34, point.y + point.z * 0.12]));
    const minX = Math.min(...allProjected.map((point) => point[0]));
    const maxX = Math.max(...allProjected.map((point) => point[0]));
    const minY = Math.min(...allProjected.map((point) => point[1]));
    const maxY = Math.max(...allProjected.map((point) => point[1]));
    const span = Math.max(0.001, maxX - minX, maxY - minY);
    const panelWidth = 270;
    const panelHeight = 300;
    const scale = 220 / span;
    const projectedCenterX = (minX + maxX) / 2;
    const projectedCenterY = (minY + maxY) / 2;
    const hue = id === "rare-1" ? 194 : id === "standard-7" ? 28 : id === "starter-fire-l" ? 8 : 50;

    const panelSvg = panels.map(({ clipName, points }, panelIndex) => {
        const left = (panelIndex % 4) * panelWidth;
        const top = Math.floor(panelIndex / 4) * panelHeight;
        const dots = points
            .sort((a, b) => a.z - b.z)
            .map((point) => {
                const px = point.x - point.z * 0.34;
                const py = point.y + point.z * 0.12;
                const x = left + panelWidth / 2 + (px - projectedCenterX) * scale;
                const y = top + panelHeight - 38 - (py - minY) * scale;
                const light = Math.max(42, Math.min(78, 58 + point.z * 14));
                return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.7" fill="hsl(${hue} 86% ${light.toFixed(1)}%)"/>`;
            })
            .join("");
        return `<g>
            <rect x="${left + 4}" y="${top + 4}" width="${panelWidth - 8}" height="${panelHeight - 8}" rx="14" fill="#070b13" stroke="#26384f"/>
            <text x="${left + 16}" y="${top + 26}" fill="#dbeafe" font-size="14" font-family="sans-serif">${clipName}</text>
            ${dots}
        </g>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * 4}" height="${panelHeight * 2}">
        <rect width="100%" height="100%" fill="#030711"/>
        <text x="16" y="18" fill="#ffffff" font-size="12" font-family="sans-serif">${id}</text>
        ${panelSvg}
    </svg>`;
    const output = resolve(outputRoot, `${id}-motion.png`);
    await sharp(Buffer.from(svg)).png().toFile(output);
    outputs.push(output);
}

const contactSheet = resolve(outputRoot, "showdown-v2-motion-contact-sheet.png");
const tiles = await Promise.all(outputs.map(async (path, index) => ({
    input: await sharp(path).resize(810, 450, { fit: "fill" }).png().toBuffer(),
    left: (index % 2) * 810,
    top: Math.floor(index / 2) * 450,
})));
await sharp({ create: { width: 1620, height: 900, channels: 3, background: "#030711" } })
    .composite(tiles)
    .png()
    .toFile(contactSheet);
console.log(contactSheet);
