import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import {assertPayloadPreservedOrReviewed,assertReviewedFullRemakePebblePayload} from './lib/pet-reviewed-payload.mjs';
import { PET_STUDIO_ASSET_REVISION, PET_PERFORMANCE_ASSET_REVISION } from '../src/lib/pet-proper-animation-assets.ts';

test('every live pet and battle LOD keeps its reviewed mesh payload and polished curves', async () => {
    const root = resolve(import.meta.dirname, '../public');
    const lod = JSON.parse(await readFile(resolve(root, 'pet-models/warfront-lod/manifest.json')));
    const paths = new Set([...runtimePetModels.map(p => p.path), ...lod.entries.map(p => resolve(root, p.lodUrl.split('?')[0].slice(1)))]);
    assert.equal(paths.size, 322);
    for (const path of paths) {
        const bytes = await readFile(path), length = bytes.readUInt32LE(12);
        const json = JSON.parse(bytes.subarray(20, 20 + length)), binary = bytes.subarray(28 + length);
        if(json.extras.pebbleFullRemake){
            assertReviewedFullRemakePebblePayload(path,bytes,json);
        }else{
        const proof = json.extras.studioPolish;
        assert.equal(proof?.revision, PET_STUDIO_ASSET_REVISION, path);
        assertPayloadPreservedOrReviewed(path,bytes,json,binary,proof);
        const performance = json.extras.performanceRefinement;
        assert.equal(performance?.revision, PET_PERFORMANCE_ASSET_REVISION, path);
        assertPayloadPreservedOrReviewed(path,bytes,json,binary,performance);
        assert.ok(performance.addedTracks > 0, path);
        for (const [i, clip] of json.animations.entries()) {
            assert.ok(clip.channels.length >= performance.sourceBoundary.channels[i], path);
            assert.equal(new Set(clip.channels.map(channel => `${channel.target.node}:${channel.target.path}`)).size, clip.channels.length, path);
        }
        }
        for (const clip of json.animations) for (const [samplerIndex, sampler] of clip.samplers.entries()) {
            if (sampler.interpolation === 'LINEAR') {
                // These reviewed 121-key quaternion takes use slerp, avoiding
                // cubic quaternion overshoot. Keep the cubic contract on every
                // other curve and reject any additional linear target.
                const channels = clip.channels.filter(channel => channel.sampler === samplerIndex);
                assert.equal(channels.length, 1, `${path}/${clip.name}: shared linear sampler`);
                const target = channels[0].target, bone = json.nodes[target.node].name;
                const head = json.extras.headMotionPresentationRepair, death = json.extras.deathPoseRepair;
                const reviewedHead = path.endsWith('mythic-1.glb') && head?.revision === '20261021-worldstorm-head-motion-v1'
                    && ['attack', 'cast', 'idle_hitreact1'].includes(clip.name)
                    && ['head', 'neck'].includes(bone) && target.path === 'rotation'
                    && head.changes.some(change => change.clip === clip.name && change.bone === bone
                        && change.keys === 121 && change.authoredMotionFraction === .35);
                const reviewedDeath = path.endsWith('mythic-6.glb') && death?.revision === '20261021-azure-terminal-collapse-v3'
                    && clip.name === 'death' && bone === 'root'
                    && ['rotation', 'translation'].includes(target.path)
                    && death.keys === 121 && death.geometrySkinOtherTracksRetained === true
                    && death.changedTracks.includes(`root.${target.path}`);
                assert.ok(reviewedHead || reviewedDeath, `${path}/${clip.name}: unreviewed linear curve ${bone}.${target.path}`);
                assert.equal(json.accessors[sampler.input].count, 121);
                assert.equal(json.accessors[sampler.output].count, 121);
                continue;
            }
            assert.equal(sampler.interpolation, 'CUBICSPLINE', `${path}/${clip.name}`);
            assert.equal(json.accessors[sampler.output].count, json.accessors[sampler.input].count * 3);
        }
    }
});
