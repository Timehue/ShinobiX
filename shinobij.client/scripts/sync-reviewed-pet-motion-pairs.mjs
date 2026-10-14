import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';
import { copyReviewedPetClips } from './lib/pet-reviewed-motion-pair.mjs';
const client = resolve(import.meta.dirname, '..'), publicRoot = resolve(client, 'public');
const manifest = JSON.parse(await readFile(resolve(publicRoot, 'pet-models/warfront-lod/manifest.json')));
const repairs = [];
const tracks = (json, clip) => clip.channels.map(c => json.nodes[c.target.node].name + ':' + c.target.path).sort();
for (const row of manifest.entries) {
    const sourcePath = resolve(publicRoot, row.sourceUrl.slice(1)), path = resolve(publicRoot, row.lodUrl.split('?')[0].slice(1));
    const source = parseStudioGlb(await readFile(sourcePath)), bytes = await readFile(path), target = parseStudioGlb(bytes);
    const clips = source.json.animations.filter(a => {
        const other = target.json.animations.find(b => b.name === a.name);
        return !other || JSON.stringify(tracks(source.json, a)) !== JSON.stringify(tracks(target.json, other));
    }).map(a => a.name);
    if (!clips.length) continue;
    // Detailed assets are the reviewed master. Battle geometry must play the
    // same take, including master decisions to leave fragile child joints neutral.
    const candidate = await copyReviewedPetClips(target, source, clips, { allowTrackReduction: true });
    if (!parseStudioGlb(candidate).bin.subarray(0, target.bin.length).equals(target.bin)) throw Error('Mesh payload changed');
    repairs.push({ path, bytes, candidate, clips });
}
// Validate all candidates first; then run full pose and LOD certification before promotion.
for (const repair of repairs) {
    const backup = resolve(client, '.tmp/pet-reviewed-pair-originals', relative(publicRoot, repair.path)); await mkdir(dirname(backup), { recursive: true });
    let prior; try { prior = await readFile(backup); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (prior && !prior.equals(repair.bytes)) throw Error('Refusing to replace a different original backup');
    if (!prior) await writeFile(backup, repair.bytes);
    await writeFile(repair.path + '.pair-tmp', repair.candidate); await rename(repair.path + '.pair-tmp', repair.path);
}
if (repairs.length) {
    const receipt = repairs.map(r => ({ path: relative(publicRoot, r.path).replaceAll('\\', '/'), clips: r.clips, beforeSha256: createHash('sha256').update(r.bytes).digest('hex'), sha256: createHash('sha256').update(r.candidate).digest('hex') }));
    await mkdir(resolve(client, '.tmp/pet-reviewed-pair'), { recursive: true });
    await writeFile(resolve(client, '.tmp/pet-reviewed-pair/receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ alignedPairs: repairs.length }));
