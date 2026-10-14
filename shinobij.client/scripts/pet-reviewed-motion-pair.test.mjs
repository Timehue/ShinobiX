import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseStudioGlb, readStudioAccessor } from './lib/pet-studio-glb.mjs';
import { copyReviewedPetClips } from './lib/pet-reviewed-motion-pair.mjs';
const publicRoot = resolve(import.meta.dirname, '../public');
test('every detailed/battle pair retains the same clip names, tracks and timing', async () => {
    const manifest = JSON.parse(await readFile(resolve(publicRoot, 'pet-models/warfront-lod/manifest.json')));
    for (const row of manifest.entries) {
        const full = parseStudioGlb(await readFile(resolve(publicRoot, row.sourceUrl.slice(1))));
        const lod = parseStudioGlb(await readFile(resolve(publicRoot, row.lodUrl.split('?')[0].slice(1))));
        const signature = json => json.animations.map(clip => ({ name: clip.name, tracks: clip.channels.map(c => json.nodes[c.target.node].name + ':' + c.target.path).sort() }));
        assert.deepEqual(signature(full.json), signature(lod.json), row.sourceUrl);
        for (let i = 0; i < full.json.animations.length; i++) {
            const duration = async (asset, clip) => Math.max(...await Promise.all(clip.samplers.map(async s => { const { values } = await readStudioAccessor(asset.json, asset.bin, s.input); return values.at(-1); })));
            assert.ok(Math.abs(await duration(full, full.json.animations[i]) - await duration(lod, lod.json.animations[i])) < 1e-6, row.sourceUrl + '/' + full.json.animations[i].name);
        }
    }
});
test('copying a reviewed take rejects an incompatible bind before changing either asset', async () => {
    const donor = parseStudioGlb(await readFile(resolve(publicRoot, 'pet-models/warfront-lod/roster/rare-31.glb')));
    const target = parseStudioGlb(await readFile(resolve(publicRoot, 'pet-models/roster/rare-31.glb')));
    const index = target.json.nodes.findIndex(n => n.name === donor.json.nodes[donor.json.animations.find(a => a.name === 'attack').channels[0].target.node].name);
    target.json.nodes[index].translation = [123, 456, 789];
    await assert.rejects(copyReviewedPetClips(target, donor, ['attack']), /Incompatible joint bind/);
});
