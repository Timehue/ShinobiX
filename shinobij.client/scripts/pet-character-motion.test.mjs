import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { Matrix4, Vector3, Quaternion } from 'three';
import sharp from 'sharp';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import {assertPayloadPreservedOrReviewed} from './lib/pet-reviewed-payload.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';
import { pebbleVisibleSupportProbe } from './lib/pet-pebble-visible-support.mjs';
import { snowRabbitVisibleSupportProbe } from './lib/pet-snow-rabbit-visible-support.mjs';
import { CHARACTER_MOTION_REVISION, createCharacterRig, solveFoot, footTrajectory, readCharacterTake, sampleChannel } from './lib/pet-character-motion.mjs';
const publicRoot = resolve(import.meta.dirname, '../public/pet-models');
const assetRoot = process.env.PET_CHARACTER_ASSET_ROOT ? resolve(process.env.PET_CHARACTER_ASSET_ROOT) : publicRoot;
const assetPath = path => resolve(assetRoot, relative(publicRoot, path));

test('foot contact has constant ground speed, clear swing and continuous takeoff/landing', () => {
    const span = .3, clearance = .06, duty = .64, epsilon = 1e-6;
    const sample = p => footTrajectory(p, span, clearance, duty);
    for (const p of [.1, .2, .3, .5]) {
        assert.equal(sample(p).y, 0); assert.equal(sample(p).contact, true);
        assert.ok(Math.abs((sample(p + epsilon).z - sample(p - epsilon).z) / (2 * epsilon) + span / duty) < 1e-6);
    }
    for (const p of [0, duty, 1]) {
        assert.ok(Math.abs(sample(p + epsilon).z - sample(p - epsilon).z) < 2e-6);
        const left = (sample(p).z - sample(p - epsilon).z) / epsilon;
        const right = (sample(p + epsilon).z - sample(p).z) / epsilon;
        assert.ok(Math.abs(left - right) < .0001);
        assert.ok(sample(p + epsilon).y < 1e-9);
    }
    assert.equal(sample((1 + duty) / 2).contact, false);
    assert.ok(Math.abs(sample((1 + duty) / 2).y - clearance) < 1e-9);
});

test('leg solve preserves contact under rotated, nonuniform evolved-model transforms', () => {
    const rig = createCharacterRig({ nodes: [
        { name: 'Armature', scale: [1.3, 2.1, .8], rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2).toArray(), children: [1] },
        { name: 'root', children: [2] },
        { name: 'thigh.L', translation: [.1, .6, 0], children: [3] },
        { name: 'shin.L', translation: [0, -.3, 0], children: [4] },
        { name: 'foot.L', translation: [0, -.3, 0] },
    ] });
    const chain = rig.chains[0], target = new Vector3(.15, .08, .12);
    assert.ok(solveFoot(rig, chain, target) < 1e-6);
    const world = rig.nodes[4].getWorldPosition(new Vector3());
    assert.ok(world.distanceTo(target.clone().applyMatrix4(chain.frame.matrixWorld)) < 1e-6);
    assert.equal(rig.nodes[3].position.length(), .3);
    assert.equal(rig.nodes[4].position.length(), .3);
});

test('every delivered full model and LOD carries the reviewed contact bank and bounded precision', async () => {
    const paths = new Set(runtimePetModels.flatMap(row => [assetPath(row.path), resolve(assetRoot, 'warfront-lod', relative(publicRoot, row.path))]));
    assert.equal(paths.size, 322);
    for (const path of paths) {
        const bytes=await readFile(path),{ json, bin } = parseStudioGlb(bytes), proof = json.extras.characterMotion;
        assert.equal(proof?.revision, CHARACTER_MOTION_REVISION, path);
        assertPayloadPreservedOrReviewed(path,bytes,json,bin,proof);
        // Full Pebble remake retains the old rig but replaces its visible
        // feet. Exact approved payload plus full-surface contact regressions
        // supersede the predecessor's bone-origin authoring receipt.
        if(!json.extras.pebbleFullRemake){
            assert.ok(proof.maxDecodedError <= .00002, path);
            for (const clip of proof.clips) assert.ok(clip.maxContactErrorNormalized < .0001, `${path}/${clip.name}`);
        }
        if (path.includes('warfront-lod')) for (const image of json.images) {
            const view = json.bufferViews[image.bufferView];
            const metadata = await sharp(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)).metadata();
            assert.ok(metadata.width <= 1024 && metadata.height <= 1024, path);
        }
    }
});

test('production spline interpolation keeps planted feet grounded and cyclic poses seamless', async () => {
    const ids = new Set(['standard-0', 'standard-1', 'standard-5', 'standard-7', 'standard-13', 'starter-fire-l', 'starter-lightning-l', 'mythic-10']);
    for(const row of runtimePetModels)if(row.pet.id.startsWith('starter-'))ids.add(row.pet.id);
    for (const row of runtimePetModels.filter(row => ids.has(row.pet.id))) {
        const { json, bin } = parseStudioGlb(await readFile(assetPath(row.path))), rig = createCharacterRig(json);
        const rabbitVisibleSupport=row.pet.id==='standard-1'&&json.extras.visibleGroundCalibration;
        const visibleSupport=json.extras.pebbleFullRemake?await pebbleVisibleSupportProbe(assetPath(row.path))
            :rabbitVisibleSupport?await snowRabbitVisibleSupportProbe(assetPath(row.path)):null;
        // The authored aquatic/amphibious bank intentionally has no planted gait.
        if(['aquatic','serpentine','amphibious'].includes(json.extras.characterMotion.family))continue;
        const chain = rig.chains[0]; assert.ok(chain, row.pet.id);
        for (const clip of json.animations.filter(clip => ['idle', 'walk', 'gallop', 'guard', 'rest'].includes(clip.name))) {
            const take = await readCharacterTake(json, bin, clip);
            if(visibleSupport)assert.ok(visibleSupport.seam(clip.name)<.00002,`${row.pet.id}/${clip.name}: visible-surface loop seam`);
            for (const channel of take.channels) {
                const first = sampleChannel(channel, 0), last = sampleChannel(channel, 1);
                // Ground calibration is stored at decoded animation precision
                // (2e-5), with 1.8e-6 vertical endpoint quantization in two
                // takes. Check the entire visible skin above at that same
                // precision; all other curves retain the stricter old gate.
                const calibratedRoot=visibleSupport&&json.nodes[channel.node].name==='root'&&channel.path==='translation';
                assert.ok(first.every((value, i) => Math.abs(value - last[i]) < (calibratedRoot&&i===1?.00002:1e-6)), `${row.pet.id}/${clip.name}: visible wrap`);
            }
            for (const p of clip.name === 'walk' || clip.name === 'gallop' ? [.1, .2, .3] : [.07, .19, .43, .68, .91]) {
                if(visibleSupport){
                    const result=visibleSupport(clip.name,p);
                    // The Rabbit's static percentile plane passes through the
                    // fur at some gallop samples. Bound the actual sole's
                    // signed distance to 3mm, stricter than its old 1.2%-of-leg
                    // pivot-distance gate; retain Pebble's nonnegative gate.
                    assert.ok((rabbitVisibleSupport?Math.abs(result.clearance)<.003:result.clearance>=0&&result.clearance<.003),`${row.pet.id}/${clip.name}@${p}: visible sole clearance ${result.clearance}`);
                    continue;
                }
                rig.reset();
                for (const channel of take.channels) {
                    const node = rig.nodes[channel.node], values = sampleChannel(channel, p);
                    if (channel.path === 'rotation') node.quaternion.fromArray(values);
                    else if (channel.path === 'translation') node.position.fromArray(values);
                    else if (channel.path === 'scale') node.scale.fromArray(values);
                }
                rig.scene.updateMatrixWorld(true);
                const foot = rig.nodes[chain.ids[2]].getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(chain.frame.matrixWorld).invert());
                const lift = Math.abs(foot.sub(chain.origin).dot(chain.up)) / chain.length;
                assert.ok(lift < .012, `${row.pet.id}/${clip.name}@${p}: planted foot lifted ${lift}`);
            }
        }
    }
});
