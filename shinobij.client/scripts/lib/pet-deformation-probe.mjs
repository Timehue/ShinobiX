import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { encodeGlb } from '../repair-bird-faces.mjs';

/** CPU copy of the actual shipping skin. Only image decoding is removed. */
export async function loadPetDeformationProbe(path) {
    return loadPetDeformationProbeBytes(await readFile(path));
}

export async function loadPetDeformationProbeBytes(bytes) {
    const length = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + length));
    const scratch = structuredClone(json);
    scratch.materials = []; scratch.images = []; scratch.textures = [];
    for (const mesh of scratch.meshes) for (const primitive of mesh.primitives) delete primitive.material;
    await MeshoptDecoder.ready;
    const copy = encodeGlb(scratch, bytes.subarray(28 + length));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(copy.buffer, '');
    const meshes = [];
    gltf.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
    const update = () => { gltf.scene.updateMatrixWorld(true); meshes.forEach(mesh => mesh.skeleton.update()); };
    update();
    return { ...gltf, meshes, json, binary: bytes.subarray(28 + length), update, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function snapshotPetPose(scene) {
    const poses = [];
    scene.traverse(node => poses.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
    return () => poses.forEach(([node, position, quaternion, scale]) => { node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale); });
}

/** Include the terminal pose, a uniform sweep, and authored keys plus midpoints. */
export function petClipSampleTimes(clip, hz = 12) {
    const keys = [...new Set(clip.tracks.flatMap(track => [...track.times]))].sort((a, b) => a - b);
    const steps = Math.max(1, Math.ceil(clip.duration * hz));
    return [...new Set([0, clip.duration, ...keys, ...keys.slice(1).map((time, i) => (time + keys[i]) / 2),
        ...Array.from({ length: steps + 1 }, (_, i) => clip.duration * i / steps)])].sort((a, b) => a - b);
}

/** Inspect head-dominant surfaces independently of body-sized tear thresholds.
 * This is a review signal, not an anatomical mask or an art certificate. */
export function preparePetHeadProbe(mesh, anatomicalMask, boneName = 'head') {
    const head = mesh.skeleton.bones.find(bone => bone.name === boneName);
    if (!head) return null;
    const headIndex = mesh.skeleton.bones.indexOf(head);
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const points = Array.from({ length: position.count }, (_, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    const selected = new Set();
    for (let i = 0; i < position.count; i++) {
        let share = 0;
        for (let s = 0; s < 4; s++) if (skinIndex.getComponent(i, s) === headIndex) share += skinWeight.getComponent(i, s);
        if (anatomicalMask ? anatomicalMask({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) }) : share >= .5) selected.add(i);
    }
    if (selected.size < 20) return { missing: true, vertices: selected.size };
    const diagonal = new THREE.Box3().setFromPoints([...selected].map(i => points[i])).getSize(new THREE.Vector3()).length();
    if (!Number.isFinite(diagonal) || diagonal < 1e-8) return { missing: true, vertices: selected.size };
    const inverse = head.matrixWorld.clone().invert();
    const rootBone=mesh.skeleton.bones.find(bone=>bone.name==='root')??mesh.skeleton.bones[0];
    const bindRootScale=Math.cbrt(Math.abs(rootBone.matrixWorld.determinant()));
    if (!Number.isFinite(bindRootScale) || bindRootScale < 1e-8) throw Error('Invalid bind root scale');
    const local = new Map([...selected].map(i => [i, points[i].clone().applyMatrix4(inverse)]));
    const edges = new Map(), index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? position.count); i += 3) for (const [a, b] of [[0,1],[1,2],[2,0]]) {
        const from = index ? index.getX(i + a) : i + a, to = index ? index.getX(i + b) : i + b;
        if (!selected.has(from) || !selected.has(to)) continue;
        const length = local.get(from).distanceTo(local.get(to));
        // Ignore quantization-sized edges; report tiny triangles in the full audit.
        if (length > diagonal * .002) edges.set(`${Math.min(from,to)},${Math.max(from,to)}`, { from, to, length,worldLength:points[from].distanceTo(points[to]) });
    }
    const posed = new Map([...selected].map(i => [i, new THREE.Vector3()]));
    const world = new Map([...selected].map(i => [i, new THREE.Vector3()]));
    return { vertices: selected.size, edges: edges.size, diagonal, measure() {
        inverse.copy(head.matrixWorld).invert();
        const rootScaleRatio=Math.cbrt(Math.abs(rootBone.matrixWorld.determinant()))/bindRootScale;
        if (!Number.isFinite(rootScaleRatio) || rootScaleRatio < 1e-8) throw Error('Invalid posed root scale');
        let squared = 0, maximum = 0, minRatio = 1, maxRatio = 1, changedEdges = 0, maximumVertex = -1,worldMinRatio=1,worldMaxRatio=1;
        for (const [i, point] of posed) {
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);world.get(i).copy(point);point.applyMatrix4(inverse);
            const distance = point.distanceTo(local.get(i)); squared += distance ** 2; if(distance>maximum){maximum=distance;maximumVertex=i;}
        }
        for (const edge of edges.values()) {
            const ratio = posed.get(edge.from).distanceTo(posed.get(edge.to)) / edge.length;
            minRatio = Math.min(minRatio, ratio); maxRatio = Math.max(maxRatio, ratio);
            const worldRatio=world.get(edge.from).distanceTo(world.get(edge.to))/edge.worldLength/rootScaleRatio;
            worldMinRatio=Math.min(worldMinRatio,worldRatio);worldMaxRatio=Math.max(worldMaxRatio,worldRatio);
            if (ratio < .65 || ratio > 1.5) changedEdges++;
        }
        return { rmsDrift: Math.sqrt(squared / selected.size) / diagonal, maxDrift: maximum / diagonal, maximumVertex, minRatio, maxRatio,worldMinRatio,worldMaxRatio, changedEdges };
    } };
}
