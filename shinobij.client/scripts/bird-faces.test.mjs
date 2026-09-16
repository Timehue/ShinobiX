import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import { BIRD_FACE_REPAIRS, BIRD_FACE_REPAIR_REVISION, birdSkullShare, birdEnvelopeMatrix, loadBird } from './repair-bird-faces.mjs';

const BEAK_SURFACES = JSON.parse(await readFile(new URL('./fixtures/bird-beak-vertices.json', import.meta.url), 'utf8')).models;

// Authored beak edges identified independently from the repair envelope using
// the source atlas and bind coordinates. These caught lateral jaw holes that
// a probe restricted to already-rigid skull vertices could not detect.
const BEAK_EDGE_FIXTURES = {
    'rare-17': [[10347, 10356], [10365, 10357]],
    'rare-37': [[16281, 16046], [16055, 16057]],
    'rare-44': [[16715, 16719], [16782, 16744]],
    'legendary-1': [[6779, 6781], [9286, 9281]],
    'legendary-10': [[762, 743]],
};

async function load(id) {
    const kind = id === 'standard-7' ? 'showdown-v2' : id.startsWith('starter-') ? 'base' : 'roster';
    const candidate = process.env.BIRD_FACE_CANDIDATES === '1';
    const path = new URL(candidate ? `../.tmp/bird-face-repair/${kind}-${id}.glb` : `../public/pet-models/${kind === 'base' ? '' : kind + '/'}${id}.glb`, import.meta.url);
    const bytes = await readFile(path), length = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + length)), binary = bytes.subarray(28 + length);
    assert.equal(json.extras?.birdFaceRepair?.revision, BIRD_FACE_REPAIR_REVISION, `${id} is missing its reviewed binding repair`);
    const original = structuredClone(json);
    original.meshes[0].primitives[0].attributes = json.extras.birdFaceRepair.original.attributes;
    original.animations = [];
    return { before: await loadBird(original, binary), after: await loadBird(json, binary) };
}

for (const [id, envelope] of Object.entries(BIRD_FACE_REPAIRS)) {
    test(`${id} retains its mesh and wings while the eyes/beak remain cohesive in all clips`, async () => {
        const { before, after } = await load(id);
        const oldMesh = before.surface, mesh = after.surface, geometry = mesh.geometry;
        for (const name of ['position', 'normal', 'uv']) assert.deepEqual(geometry.attributes[name].array, oldMesh.geometry.attributes[name].array, `${id}: ${name} must remain unchanged`);
        assert.deepEqual(geometry.index.array, oldMesh.geometry.index.array);
        const joints = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
        const oldJoints = oldMesh.geometry.attributes.skinIndex, oldWeights = oldMesh.geometry.attributes.skinWeight;
        const head = mesh.skeleton.bones.findIndex(bone => bone.name === 'head');
        const correction = birdEnvelopeMatrix(mesh);
        const points = [], skull = new Set();
        const beakFixture = BEAK_SURFACES[id], beakVertices = new Set(beakFixture?.vertices ?? []);
        if (beakFixture) {
            const position = geometry.attributes.position;
            const values = Float32Array.from({ length: position.count * 3 }, (_, index) => position.getComponent(Math.floor(index / 3), index % 3));
            assert.equal(createHash('sha256').update(Buffer.from(values.buffer)).digest('hex'), beakFixture.positionSha256, 'authored beak fixture requires review after a mesh replacement');
        }
        let unchanged = 0, restDrift = 0;
        for (let vertex = 0; vertex < joints.count; vertex++) {
            const point = mesh.getVertexPosition(vertex, new THREE.Vector3());
            points.push(point);
            restDrift = Math.max(restDrift, point.distanceTo(oldMesh.getVertexPosition(vertex, new THREE.Vector3())));
            const bind = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, vertex).applyMatrix4(correction);
            const share = birdSkullShare(bind, envelope);
            if (share === 0) {
                unchanged++;
                for (let slot = 0; slot < 4; slot++) {
                    assert.equal(joints.getComponent(vertex, slot), oldJoints.getComponent(vertex, slot), 'wing/body joints must stay unchanged');
                    assert.ok(Math.abs(weights.getComponent(vertex, slot) - oldWeights.getComponent(vertex, slot)) < 1e-7, 'wing/body weights must stay unchanged');
                }
            }
            if (share > 0.999999 || beakVertices.has(vertex)) {
                let headWeight = 0;
                for (let slot = 0; slot < 4; slot++) if (joints.getComponent(vertex, slot) === head) headWeight += weights.getComponent(vertex, slot);
                assert.ok(headWeight > 0.999, beakVertices.has(vertex) ? 'independently selected beak surface must not follow a wing joint' : 'skull vertices must not follow a wing joint');
                skull.add(vertex);
            }
        }
        assert.ok(restDrift < 1e-5, `${id}: bind mesh moved by ${restDrift}`);
        assert.ok(skull.size > 300 && unchanged > joints.count * 0.35, 'the repair must isolate the skull and preserve the lower body/wings');
        const index = geometry.index, uniqueEdges = new Map();
        for (let triangle = 0; triangle < index.count; triangle += 3) for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
            const a = index.getX(triangle + from), b = index.getX(triangle + to);
            if ((!skull.has(a) || !skull.has(b)) && (!beakVertices.has(a) || !beakVertices.has(b))) continue;
            const length = points[a].distanceTo(points[b]);
            if (length > 0.002) uniqueEdges.set(a < b ? `${a},${b}` : `${b},${a}`, { a, b, length });
        }
        assert.ok(uniqueEdges.size > 300, 'insufficient facial topology for the deformation probe');
        const stride = Math.max(1, Math.ceil(uniqueEdges.size / 1200));
        const edges = [...uniqueEdges.values()].filter((edge, index) => index % stride === 0 || (beakVertices.has(edge.a) && beakVertices.has(edge.b)));
        for (const [a, b] of BEAK_EDGE_FIXTURES[id] ?? []) {
            assert.ok(a < points.length && b < points.length, 'authored beak fixture is missing');
            edges.push({ a, b, length: points[a].distanceTo(points[b]), authoredBeak: true });
        }
        const vertices = [...new Set(edges.flatMap(edge => [edge.a, edge.b]))];
        const posed = new Map(vertices.map(vertex => [vertex, new THREE.Vector3()]));
        const bind = mesh.skeleton.bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
        const mixer = new THREE.AnimationMixer(after.scene);
        assert.equal(after.animations.length, 13);
        for (const clip of after.animations) {
            mixer.stopAllAction();
            mesh.skeleton.bones.forEach((bone, index) => { bone.position.copy(bind[index].p); bone.quaternion.copy(bind[index].q); bone.scale.copy(bind[index].s); });
            const action = mixer.clipAction(clip).reset().play();
            const times = [...new Set(clip.tracks.flatMap(track => [...track.times]))].sort((a, b) => a - b);
            for (const time of [...times, ...times.slice(1).map((time, index) => (time + times[index]) / 2)]) {
                action.time = time; mixer.update(0); after.scene.updateMatrixWorld(true); mesh.skeleton.update();
                for (const vertex of vertices) mesh.getVertexPosition(vertex, posed.get(vertex));
                for (const edge of edges) {
                    const ratio = posed.get(edge.a).distanceTo(posed.get(edge.b)) / edge.length;
                    assert.ok(ratio > 1 / 1.7 && ratio < 1.7, `${id}/${clip.name}: ${edge.authoredBeak ? "authored beak" : "skull"} edge ${edge.a}/${edge.b} deforms by ${ratio.toFixed(3)}x`);
                }
            }
        }
        mixer.stopAllAction();
    });
}
