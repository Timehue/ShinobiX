import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { stablePetModelPresentationBounds } from '../../src/lib/pet-model-bounds.ts';
import { align4, encodeStudioGlb, parseStudioGlb, readStudioAccessor } from './pet-studio-glb.mjs';
import { loadPetDeformationProbe, snapshotPetPose } from './pet-deformation-probe.mjs';

export const VISIBLE_GROUND_INPUTS = Object.freeze({
    "rare-22": {
        "source": "9d1faf17bae5e82929e4489a25b7f6263c869d226afb8f93615aa542dfe7d1f5",
        "battle": "6f6be91ae45623ad4b25c58a4d683e031795002fcf274692d0ff75a19bbc48ab"
    },
    "rare-26": {
        "source": "eb2db91ac4d04d87342500e2507d5bcfbbe322128bb194e5990d7eada4a0c957",
        "battle": "7956ea6af5fce5213a5a9d9f566dba857a7d9f9a700607c6080e45b7bc7c1a2c"
    },
    "rare-29": {
        "source": "8a990bcc34a418574a870129d641c1e3271620a9f7844657ebd356dfb0f254e3",
        "battle": "fe6d23239e71b69dabd9c5de4fc5f0eab8132aac014cbc25510e5a0ff838f726"
    },
    "rare-31": {
        "source": "b03612bd77f9302cb11c1e8fe0a2d6d55a261b910dd2dad19d9138519fb452c6",
        "battle": "5ca3d791525829402ac9a37a04944fc80aeaf218d8b8fcc8255e6c8fdebbec00"
    }
});

function evaluateOriginal(times, values, time) {
    let index = 0;
    while (index < times.length - 2 && times[index + 1] < time) index++;
    const h = times[index + 1] - times[index], u = Math.max(0, Math.min(1, (time - times[index]) / h));
    const position = [], tangent = [];
    for (let axis = 0; axis < 3; axis++) {
        const a = values[index * 9 + 3 + axis], ta = values[index * 9 + 6 + axis];
        const b = values[(index + 1) * 9 + 3 + axis], tb = values[(index + 1) * 9 + axis];
        position.push((2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*h*ta+(-2*u**3+3*u*u)*b+(u**3-u*u)*h*tb);
        tangent.push((6*u*u-6*u)/h*a+(3*u*u-4*u+1)*ta+(-6*u*u+6*u)/h*b+(3*u*u-2*u)*tb);
    }
    return { position, tangent };
}

function appendAccessor(model, data, type, width) {
    const offset = align4(model.bin.length), bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    model.bin = Buffer.concat([model.bin, Buffer.alloc(offset - model.bin.length), bytes]);
    const bufferView = model.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1;
    return model.json.accessors.push({ bufferView, componentType: 5126, count: data.length / width, type }) - 1;
}

/** Bake vertical clearance against actual source AND battle surfaces. The
 * sculpt, skin, rig, horizontal trajectory and other joint curves are retained.
 * This is an authoring operation; artistic approval is recorded separately. */
export async function calibratePetVisibleGround({ id, sourcePath, battlePath, sourceOutput, battleOutput }) {
    const pins = VISIBLE_GROUND_INPUTS[id];
    assert.ok(pins, 'No independently diagnosed ground calibration for ' + id);
    const models = [];
    try {
        for (const [stage, path] of [['source', sourcePath], ['battle', battlePath]]) {
            const bytes = await readFile(path);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), pins[stage], id + '/' + stage + ': unexpected input');
            const model = await loadPetDeformationProbe(path), root = model.scene.getObjectByName('root');
            assert.deepEqual(root.parent.matrixWorld.elements, new THREE.Matrix4().elements);
            models.push({ stage, model, ...parseStudioGlb(bytes), restore: snapshotPetPose(model.scene),
                mixer: new THREE.AnimationMixer(model.scene), ground: stablePetModelPresentationBounds(model.scene).groundY,
                rootId: model.json.nodes.findIndex(node => node.name === 'root') });
        }
        const ground = Math.max(...models.map(model => model.ground)), padding = .002, point = new THREE.Vector3(), corrections = [];
        for (const take of models[0].model.animations) {
            const originals = [];
            for (const model of models) {
                const clip = model.json.animations.find(clip => clip.name === take.name);
                const channel = clip.channels.find(channel => channel.target.node === model.rootId && channel.target.path === 'translation');
                assert.ok(channel, 'Expected root translation for ' + take.name);
                const sampler = clip.samplers[channel.sampler];
                assert.equal(sampler.interpolation, 'CUBICSPLINE');
                originals.push({ model, sampler, input: (await readStudioAccessor(model.json, model.bin, sampler.input)).values,
                    output: (await readStudioAccessor(model.json, model.bin, sampler.output)).values });
            }
            assert.deepEqual(originals[0].input, originals[1].input);
            assert.deepEqual(originals[0].output, originals[1].output);
            const steps = Math.ceil(take.duration * 240);
            const times = Float32Array.from([...new Set([...originals[0].input,
                ...Array.from({ length: steps + 1 }, (_, index) => Math.fround(take.duration * index / steps))])].sort((a,b) => a-b));
            const lifts = [];
            for (const time of times) {
                let minimum = Infinity;
                for (const model of models) {
                    const clip = model.model.animations.find(clip => clip.name === take.name);
                    model.mixer.stopAllAction(); model.restore();
                    const action = model.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true; action.play(); action.time = time; model.mixer.update(0); model.model.update();
                    for (const mesh of model.model.meshes) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++)
                        minimum = Math.min(minimum, mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld).y);
                }
                lifts.push(Math.max(0, ground + padding - minimum));
            }
            // Harmonic monotone slopes avoid overshooting where the contacting
            // vertex changes. Independent midpoint sampling verifies clearance.
            const slopes = times.map((_, index) => {
                if (index === 0 || index === times.length - 1 || lifts[index] === 0) return 0;
                const a = (lifts[index]-lifts[index-1])/(times[index]-times[index-1]);
                const b = (lifts[index+1]-lifts[index])/(times[index+1]-times[index]);
                return a*b > 0 ? 2*a*b/(a+b) : 0;
            });
            for (const { model, sampler, input, output } of originals) {
                const values = new Float32Array(times.length * 9);
                for (let index = 0; index < times.length; index++) {
                    const prior = evaluateOriginal(input, output, times[index]);
                    for (let axis = 0; axis < 3; axis++) {
                        values[index*9+axis] = values[index*9+6+axis] = prior.tangent[axis] + (axis === 1 ? slopes[index] : 0);
                        values[index*9+3+axis] = prior.position[axis] + (axis === 1 ? lifts[index] : 0);
                    }
                }
                const inputAccessor = appendAccessor(model, times, 'SCALAR', 1);
                model.json.accessors[inputAccessor].min = [times[0]];
                model.json.accessors[inputAccessor].max = [times.at(-1)];
                Object.assign(sampler, { input: inputAccessor, output: appendAccessor(model, values, 'VEC3', 3), interpolation: 'CUBICSPLINE' });
            }
            corrections.push({ clip: take.name, keys: times.length, maximumLift: Math.max(...lifts) });
        }
        const outputs = [];
        for (const model of models) {
            model.json.buffers[0].byteLength = model.bin.length;
            model.json.extras.visibleGroundCalibration = { revision: '20261020-visible-ground-v1', id,
                inputSha256: pins[model.stage], ground, padding, sampleHz: 240,
                scope: 'Union of exact source and battle visible surface minima; vertical root correction only.', corrections };
            model.json.extras.properAnimationSourceBoundary = { binLength: model.bin.length,
                accessorCount: model.json.accessors.length, bufferViewCount: model.json.bufferViews.length };
            const bytes = encodeStudioGlb(model.json, model.bin), path = model.stage === 'source' ? sourceOutput : battleOutput;
            await writeFile(path, bytes);
            outputs.push({ stage: model.stage, path, sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        return { id, ground, padding, corrections, outputs };
    } finally {
        for (const model of models) { model.mixer.stopAllAction(); for (const mesh of model.model.meshes) mesh.geometry.dispose(); }
    }
}
