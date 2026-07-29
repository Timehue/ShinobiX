import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

globalThis.self = globalThis;

const sourceUrl = new URL("../public/pet-models/gate-warden-rigged.glb", import.meta.url);
const bytes = await readFile(sourceUrl);
await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
);

let mesh = null;
gltf.scene.traverse((node) => {
    if (!mesh && node instanceof THREE.SkinnedMesh) mesh = node;
});
if (!mesh) throw new Error("Rigged Gate Warden skinned mesh was not found.");

const samples = [
    ["GW_Idle", 0.6],
    ["GW_Walk", 0.3],
    ["GW_Windup", 0.7],
    ["GW_Slam", 0.27],
    ["GW_Hit", 0.08],
];
const mixer = new THREE.AnimationMixer(gltf.scene);
const panels = [];
for (const [clipName, time] of samples) {
    mixer.stopAllAction();
    gltf.scene.traverse((node) => {
        if (node instanceof THREE.Bone) node.quaternion.identity();
    });
    const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
    if (!clip) throw new Error(`Missing ${clipName}`);
    const action = mixer.clipAction(clip);
    action.reset().play();
    mixer.setTime(time);
    gltf.scene.updateMatrixWorld(true);
    mesh.skeleton.update();

    const position = mesh.geometry.getAttribute("position");
    const points = [];
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 2) {
        point.fromBufferAttribute(position, i);
        mesh.applyBoneTransform(i, point);
        points.push(point.clone());
    }
    panels.push({ clipName, points });
}

const panelWidth = 240;
const panelHeight = 330;
const panelSvg = panels.map(({ clipName, points }, panelIndex) => {
    const x0 = panelIndex * panelWidth;
    const dots = points
        .sort((left, right) => left.z - right.z)
        .map((point) => {
            const x = x0 + panelWidth / 2 + point.x * 92;
            const y = 174 - point.y * 116;
            const light = Math.max(42, Math.min(78, 56 + point.z * 30));
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.85" fill="hsl(274 88% ${light.toFixed(1)}%)"/>`;
        })
        .join("");
    return `<g>
        <rect x="${x0 + 5}" y="5" width="${panelWidth - 10}" height="${panelHeight - 10}" rx="16" fill="#080511" stroke="#3b1d58"/>
        <text x="${x0 + 18}" y="30" fill="#e9d5ff" font-size="15" font-family="sans-serif">${clipName}</text>
        ${dots}
    </g>`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * panels.length}" height="${panelHeight}">
    <rect width="100%" height="100%" fill="#02030a"/>
    ${panelSvg}
</svg>`;
const outputPath = fileURLToPath(new URL("../tmp/gate-warden-rig-preview.png", import.meta.url));
await sharp(Buffer.from(svg)).png().toFile(outputPath);
console.log(outputPath);
