import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as THREE from 'three';
import { calibratePetVisibleGround, VISIBLE_GROUND_INPUTS } from './lib/pet-visible-ground-calibration.mjs';
import { loadPetDeformationProbe, snapshotPetPose } from './lib/pet-deformation-probe.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';

const expected = {
    'rare-22': { source: 'f50d9633162ca2e010369e6ab0151c0c27601b4dbf891cc187f688e28fa1d86d', battle: '2c016dcee0d876195d77f3a30720c8d9751abac98347aaa8c6dbb154198b0d27' },
    'rare-26': { source: '5d018d1191f4abbc79147e6e9cb3c4555469946229cbf009291e6c1e60ed2466', battle: 'b12986b479f2dabe03452925abb12184c0481c128a0b3ed1e97af49b059efdb1' },
    'rare-29': { source: '2b54c6728cb11057b0f92bacd91f990bfa4d44a6c2c6e933fac08e11f31c1bd9', battle: '4922b143c199ae44aa2627eda51635b28f05ec46b267100a09dcfcfe5ba798f3' },
};
const input = (id, stage) => fileURLToPath(new URL(`./fixtures/pet-visible-ground-20261020/${id}-${stage}.glb`, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

for (const id of Object.keys(expected)) test(`${id} replays its pinned visible-floor repair and preserves anatomy and performances`, async () => {
    const temporaryRoot = resolve(tmpdir()), directory = await mkdtemp(join(temporaryRoot, 'pet-visible-ground-'));
    const loaded = [];
    try {
        const outputs = { source: join(directory, 'source.glb'), battle: join(directory, 'battle.glb') };
        const result = await calibratePetVisibleGround({ id, sourcePath: input(id, 'source'), battlePath: input(id, 'battle'), sourceOutput: outputs.source, battleOutput: outputs.battle });
        assert.equal(result.corrections.length, 13);
        for (const stage of ['source', 'battle']) {
            const originalBytes = await readFile(input(id, stage)), bytes = await readFile(outputs[stage]);
            assert.equal(sha(originalBytes), VISIBLE_GROUND_INPUTS[id][stage]);
            assert.equal(sha(bytes), expected[id][stage]);
            const original = parseStudioGlb(originalBytes), candidate = parseStudioGlb(bytes);
            assert.ok(candidate.bin.subarray(0, original.bin.length).equals(original.bin), 'Original binary streams must remain intact');
            for (const key of ['nodes', 'skins', 'meshes', 'materials', 'images']) assert.deepEqual(candidate.json[key], original.json[key], key + ' changed');
            const before = await loadPetDeformationProbe(input(id, stage)), after = await loadPetDeformationProbe(outputs[stage]);
            loaded.push(before, after);
            const restore = snapshotPetPose(after.scene), mixer = new THREE.AnimationMixer(after.scene), point = new THREE.Vector3();
            assert.equal(after.animations.length, 13);
            let maximumHorizontalError = 0, minimumClearance = Infinity, poses = 0;
            for (const clip of after.animations) {
                const prior = before.animations.find(take => take.name === clip.name);
                assert.equal(clip.duration, prior.duration); assert.equal(clip.tracks.length, prior.tracks.length);
                const root = clip.tracks.find(track => track.name === 'root.position'), priorRoot = prior.tracks.find(track => track.name === 'root.position');
                for (const track of clip.tracks) if (track !== root) {
                    const old = prior.tracks.find(value => value.name === track.name);
                    assert.deepEqual(track.times, old.times); assert.deepEqual(track.values, old.values);
                    assert.equal(track.getInterpolation(), old.getInterpolation());
                }
                const a = root.createInterpolant(new Float32Array(3)), b = priorRoot.createInterpolant(new Float32Array(3));
                // Offset from the 240Hz authoring grid; includes both endpoints.
                const count = Math.ceil(clip.duration * 120), times = [0, ...Array.from({ length: count }, (_, index) => (index + .5) * clip.duration / count), clip.duration];
                for (const time of times) {
                    const x = a.evaluate(time), y = b.evaluate(time);
                    maximumHorizontalError = Math.max(maximumHorizontalError, Math.abs(x[0]-y[0]), Math.abs(x[2]-y[2]));
                    assert.ok(x[1] >= y[1] - .000002, 'Vertical repair must never push the model downward');
                    mixer.stopAllAction(); restore();
                    const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true; action.play(); action.time = time; mixer.update(0); after.update();
                    for (const mesh of after.meshes) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++)
                        minimumClearance = Math.min(minimumClearance, mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld).y - result.ground);
                    poses++;
                }
            }
            mixer.stopAllAction();
            assert.equal(poses, { 'rare-22': 1871, 'rare-26': 1731, 'rare-29': 1667 }[id]); assert.ok(maximumHorizontalError < .000002);
            assert.ok(minimumClearance >= .001, stage + ': visible surface intersects floor');
            // Reject the actual original failure using surface vertices, rather
            // than trusting the repair metadata or a handful of foot joints.
            const oldMixer = new THREE.AnimationMixer(before.scene), oldRestore = snapshotPetPose(before.scene);
            let originalClearance = Infinity;
            for (const clip of before.animations.filter(clip => ['cast', 'attack', 'idle_hitreact1'].includes(clip.name))) for (const phase of [.2, .5, .8]) {
                oldMixer.stopAllAction(); oldRestore(); const action = oldMixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true; action.play(); action.time = clip.duration * phase; oldMixer.update(0); before.update();
                for (const mesh of before.meshes) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++)
                    originalClearance = Math.min(originalClearance, mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld).y - result.ground);
            }
            oldMixer.stopAllAction(); assert.ok(originalClearance < -.02, 'Regression must detect the original visible-floor penetration');
        }
        await assert.rejects(calibratePetVisibleGround({ id, sourcePath: input(id, 'battle'), battlePath: input(id, 'source'), sourceOutput: outputs.source, battleOutput: outputs.battle }), /unexpected input/);
        // Keep a compact numeric receipt in the test's isolated directory.
        await writeFile(join(directory, 'result.json'), JSON.stringify(result));
    } finally {
        for (const model of loaded) for (const mesh of model.meshes) mesh.geometry.dispose();
        assert.equal(dirname(resolve(directory)), temporaryRoot);
        assert.ok(resolve(directory).startsWith(join(temporaryRoot, 'pet-visible-ground-')));
        await rm(directory, { recursive: true, force: true });
    }
});
