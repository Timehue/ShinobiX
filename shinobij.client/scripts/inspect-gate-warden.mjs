import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

globalThis.self = globalThis;

const sourcePath = process.argv[2]
    ? pathToFileURL(resolve(process.argv[2]))
    : new URL("../public/pet-models/gate-warden.glb", import.meta.url);
const bytes = await readFile(sourcePath);
const sourceView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const jsonLength = sourceView.getUint32(12, true);
const sourceJson = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
);

const meshes = [];
const plotPoints = [];
gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute("position");
    const index = node.geometry.getIndex();
    const bounds = new THREE.Box3().setFromBufferAttribute(position);
    for (let i = 0; i < position.count; i += 2) {
        plotPoints.push([position.getX(i), position.getY(i), position.getZ(i)]);
    }
    const parent = new Int32Array(position.count);
    const size = new Int32Array(position.count);
    for (let i = 0; i < parent.length; i++) {
        parent[i] = i;
        size[i] = 1;
    }
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
    const join = (left, right) => {
        let a = find(left);
        let b = find(right);
        if (a === b) return;
        if (size[a] < size[b]) [a, b] = [b, a];
        parent[b] = a;
        size[a] += size[b];
    };
    if (index) {
        for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            join(a, b);
            join(b, c);
        }
    }
    const componentsByRoot = new Map();
    for (let i = 0; i < position.count; i++) {
        const root = find(i);
        let component = componentsByRoot.get(root);
        if (!component) {
            component = { vertices: 0, bounds: new THREE.Box3(), centroid: new THREE.Vector3() };
            componentsByRoot.set(root, component);
        }
        const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
        component.vertices++;
        component.bounds.expandByPoint(point);
        component.centroid.add(point);
    }
    const components = [...componentsByRoot.values()]
        .map((component) => ({
            vertices: component.vertices,
            centroid: component.centroid.multiplyScalar(1 / component.vertices).toArray(),
            min: component.bounds.min.toArray(),
            max: component.bounds.max.toArray(),
            size: component.bounds.getSize(new THREE.Vector3()).toArray(),
        }))
        .sort((a, b) => b.vertices - a.vertices)
        .slice(0, 40);
    meshes.push({
        name: node.name,
        vertices: position.count,
        triangles: index ? index.count / 3 : position.count / 3,
        indexed: Boolean(index),
        bounds: {
            min: bounds.min.toArray(),
            max: bounds.max.toArray(),
            size: bounds.getSize(new THREE.Vector3()).toArray(),
        },
        attributes: Object.fromEntries(
            Object.entries(node.geometry.attributes).map(([name, attribute]) => [name, attribute.itemSize]),
        ),
        morphTargets: Object.keys(node.geometry.morphAttributes),
        components,
        material: Array.isArray(node.material)
            ? node.material.map((material) => material.name)
            : node.material.name,
    });
});

const plot = (x0, projectX, projectY, depth, label) => {
    const circles = [...plotPoints]
        .sort((a, b) => depth(a) - depth(b))
        .map((point) => {
            const x = x0 + 260 + projectX(point) * 235;
            const y = 275 - projectY(point) * 235;
            const light = 48 + Math.round((depth(point) + 0.5) * 28);
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.1" fill="hsl(274 88% ${Math.max(35, Math.min(78, light))}%)"/>`;
        })
        .join("");
    return `<g><rect x="${x0 + 16}" y="16" width="488" height="518" rx="18" fill="#080511" stroke="#3b1d58"/><text x="${x0 + 36}" y="50" fill="#e9d5ff" font-size="20" font-family="sans-serif">${label}</text>${circles}</g>`;
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="550" viewBox="0 0 1040 550">
<rect width="1040" height="550" fill="#02030a"/>
${plot(0, (p) => p[0], (p) => p[1], (p) => p[2], "Front projection (X/Y)")}
${plot(520, (p) => p[2] * 1.8, (p) => p[1], (p) => p[0] * 0.5, "Side projection (Z/Y)")}
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL("../tmp/gate-warden-point-cloud.png", import.meta.url)));
await writeFile(new URL("../tmp/gate-warden-inspection.json", import.meta.url), JSON.stringify({ meshes }, null, 2));

console.log(JSON.stringify({
    sourceMaterialGraph: {
        extensionsUsed: sourceJson.extensionsUsed,
        materials: sourceJson.materials,
        textures: sourceJson.textures,
        images: sourceJson.images,
        samplers: sourceJson.samplers,
    },
    sceneChildren: gltf.scene.children.map((node) => ({ name: node.name, type: node.type })),
    animations: gltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
    meshes,
}, null, 2));
