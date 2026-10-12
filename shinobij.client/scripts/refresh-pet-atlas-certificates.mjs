/** Refresh byte hashes after lossless GLB stream compaction. Atlas pixels and
 * every live source payload must match their previously certified content. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const client = resolve(import.meta.dirname, '..'), models = resolve(client, 'public/pet-models');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const lod = JSON.parse(await readFile(resolve(models, 'warfront-lod/manifest.json')));
const atlasPath = resolve(models, 'warfront-impostors/manifest.json'), atlas = JSON.parse(await readFile(atlasPath));
const receipts = JSON.parse(await readFile(resolve(client, '.tmp/pet-stream-originals/receipt.json')));
for (const entry of atlas.entries) {
    const source = lod.entries.find(row => row.sourceUrl === entry.sourceUrl);
    const path = source.lodUrl.split('?')[0].slice('/pet-models/'.length);
    if (source.lodSha256 !== entry.lodSha256) {
        const proof = receipts.find(row => row.path.replaceAll('\\', '/') === path);
        const original = await readFile(resolve(client, '.tmp/pet-stream-originals', proof?.backupPath ?? path));
        const current = await readFile(resolve(models, path));
        if (!proof?.livePayloadsUnchanged || digest(original) !== entry.lodSha256 || digest(current) !== source.lodSha256 || proof.sha256 !== source.lodSha256) throw Error(`${entry.sourceUrl}: compaction proof does not match the certified atlas input`);
    }
    const image = await readFile(resolve(client, 'public', entry.atlasUrl.slice(1)));
    if (digest(image) !== entry.atlasSha256) throw Error(`${entry.sourceUrl}: atlas pixels changed`);
    entry.lodUrl = source.lodUrl; entry.lodSha256 = source.lodSha256;
}
await writeFile(atlasPath, JSON.stringify(atlas, null, 2) + '\n');
console.log(JSON.stringify({ atlases: atlas.entries.length, unchangedPixels: true, verifiedLivePayloads: true }));
