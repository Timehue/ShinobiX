import assert from 'node:assert/strict';
import {createCachedPetVertexReader} from './pet-cached-skin-reader.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { stablePetModelPresentationBounds } from '../../src/lib/pet-model-bounds.ts';
import { align4, encodeStudioGlb, parseStudioGlb, readStudioAccessor } from './pet-studio-glb.mjs';
import { loadPetDeformationProbe, snapshotPetPose } from './pet-deformation-probe.mjs';

export const VISIBLE_GROUND_INPUTS = Object.freeze({
    'standard-1': {"source":"451b7679cf31e7e3420bba8a0481b1c9aa7481069ab77ab1158ffc7ff234ad59","battle":"79efc5087d6fc35e9a0b83e64eebc04b066bb330ec96beeb2f00b34d8728aa84"},
    'legendary-0': {"source":"b58e7aa7271d8bbcbc72b86c78681740987f4e9ba5f3ef55245c9b876c277e94","battle":"e31d47b97728f39974071e5c0e3c8a41e949b1614463caaa17065d37f5de1e4b"},
    'rare-11': {"source":"873ad9dac335256ba6e4593cdcb0e10d14d13fce90eee38117269cb8dc2acaa2","battle":"59adb3b97e2e81514282361cdfb508b91336d849ce9c0d9136269859fb6d6622"},
    'rare-9': {source:'89b1464684b0431542a57acfae486c25d8a92641d8e69dfa061d1ec55225d149',battle:'4691332d97aff53f4703c9b687cc1e4d56602e41541b8653c822568fb232fcec'},
    'rare-8': {source:'671541dd6cc8a04ca8db771a1c8ecf171dee6b265b14a579e71fc3c437512143',battle:'fc47d9fe23148c60634bb41f92573c9857a5610d800616426c312c707b7e6f8e'},
    'rare-6': {source:'230a2041d81a4e1f4bbada2c9e807772534e6ca3312b9d09dff41b8b7c8402d3',battle:'c06e19771b8f0f28deebb554b1661ab6e0c56774dd0d09c5853ff5408d6270bc'},
    'rare-5': {source:'50d9ff49323d61384d8bd337f3d5905985e255301242d27476cd9a18dd2f0056',battle:'b85588e2b12435422d9f7603b81490798157e97d151d5367fad2aacb313040df'},
    'rare-49': {"source":"57c9d42e098b902a60628813880fe28723c678e0f447ba4cef623f1dafeb4fea","battle":"fb00223abecfabf5282385cf7e42d731b2e7feb8f4af22aea7cb5be618a089c9"},
    'rare-48': {"source":"01c212a3efa407396080eba4fe01431e1ffd8639f846e4a98634637281791369","battle":"0a2b69771489c5359433cb833d1f1f95f82e856bc79ce513d19d032f46c9e688"},
    'rare-47': {"source":"55607bc1e8e892f0f2bba7c962a3b7604e16357212c702a382d70dc35308e608","battle":"02bb91602e60d8a44626c917e58b0ed9509affbf49f81ea31832bd0329390818"},
    'rare-45': {"source":"b73d69a2c2dc5057a5f0a738e7e2668a0d2b01ba1611d41c5361a71cc57195fb","battle":"88f210c75518d98e6bcd7c32bd47c2b5cea977e355a84a64118ccfe5ff032c46"},
    'rare-0': {"source":"e7e081922b30881d01c4815aa694942871ac7e8ab725dc2c53e420b882d9216e","battle":"6571644765d813ddb1b4ae6c22dd5ab7cdbb7856576a1ab0b923e9d5abff8a46"},
    'rare-42': {"source":"0c13b7ed25b0ed4e8d63ca7390dd750ecc0f221e18b26c40147e6d30510602d7","battle":"4f210aba5bd6fc0c2aba7e72d2df6b301939d7a9bec22adfac9949a36b1e6993"},
    'standard-48': {"source":"d7dc478a68260493046fc2db98da25dc1861fcda79faca34e1af76b87912a909","battle":"38cc43abb338013ad19523d03e49baf99163c524b35d4b084f3b8a241072ac64"},
    'standard-49': {"source":"8a9f82c8ac40aedbd389a63e9dd8a096f9b5dfffaac048d8a53dc354187f66ec","battle":"7a3f3b1d4eb7e31b0e0c4fecbf4c732dbc7c6e27dcdf67bd4daef8cdca2aa558"},
    'rare-34': {source:'5d804a8d8d2e73532b96378ebc610a751515df5c76ec4bd9a5c614ff8daefa6d',battle:'1f958ce2fb2b894acba1cd4c45e91be8939bad6aded5d271b9fb61c8e680fcdc'},
    'standard-47': {source:'59b14516ed67e73d84eeb19ff372161a8e2fe77074acaa1b17354cae7bade6e0',battle:'f0ffdcd08fc02c97e19c121254242b0fad8afd996f26cafa8e1b86315eb00b75'},
    'rare-22': {
        source: '9d1faf17bae5e82929e4489a25b7f6263c869d226afb8f93615aa542dfe7d1f5',
        battle: '6f6be91ae45623ad4b25c58a4d683e031795002fcf274692d0ff75a19bbc48ab',
    },
    'rare-26': {
        source: 'eb2db91ac4d04d87342500e2507d5bcfbbe322128bb194e5990d7eada4a0c957',
        battle: '7956ea6af5fce5213a5a9d9f566dba857a7d9f9a700607c6080e45b7bc7c1a2c',
    },
    'rare-29': {
        source: '8a990bcc34a418574a870129d641c1e3271620a9f7844657ebd356dfb0f254e3',
        battle: 'fe6d23239e71b69dabd9c5de4fc5f0eab8132aac014cbc25510e5a0ff838f726',
    },
    'rare-31': {
        source: 'b03612bd77f9302cb11c1e8fe0a2d6d55a261b910dd2dad19d9138519fb452c6',
        battle: '5ca3d791525829402ac9a37a04944fc80aeaf218d8b8fcc8255e6c8fdebbec00',
    },
    'rare-32': {
        source: '7bdcf083353458cd8cec1b100ac119f1450fa08d0aafc75884a3c5dad5b17fc9',
        battle: 'c9eed68e14dcaf73b0a8b193baed67f528a047ec9808e175d820470b8381c19a',
    },
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
export async function calibratePetVisibleGround({ id, sourcePath, battlePath, sourceOutput, battleOutput, cacheSkinTransforms = true, inputPins }) {
    assert.ok(VISIBLE_GROUND_INPUTS[id], 'No independently diagnosed ground calibration for ' + id);
    // A reviewed sculpt revision needs new exact input pins while retaining the
    // original negative control and the same visible-surface clearance gates.
    const pins = inputPins ?? VISIBLE_GROUND_INPUTS[id];
    for (const stage of ['source', 'battle']) assert.match(pins[stage] ?? '', /^[a-f0-9]{64}$/, 'Pin both calibration inputs');
    const models = [];
    try {
        for (const [stage, path] of [['source', sourcePath], ['battle', battlePath]]) {
            const bytes = await readFile(path);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), pins[stage], id + '/' + stage + ': unexpected input');
            const model = await loadPetDeformationProbe(path), root = model.scene.getObjectByName('root');
            assert.deepEqual(root.parent.matrixWorld.elements, new THREE.Matrix4().elements);
            models.push({ stage, model, skinReader:cacheSkinTransforms?createCachedPetVertexReader(model.meshes):null, ...parseStudioGlb(bytes), restore: snapshotPetPose(model.scene),
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
                    action.clampWhenFinished = true; action.play(); action.time = time; model.mixer.update(0); model.model.update(); model.skinReader?.sync();
                    for (const mesh of model.model.meshes) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++)
                        minimum = Math.min(minimum, (model.skinReader?model.skinReader.getVertexPosition(mesh,vertex,point):mesh.getVertexPosition(vertex,point)).applyMatrix4(mesh.matrixWorld).y);
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
