import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {rebuildDuneViperNoCoil} from './lib/pet-dune-viper-no-coil.mjs';

const root = new URL('./fixtures/pet-dune-viper-no-coil-20261021/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
const inputs = {};
for (const [name, pin] of Object.entries(manifest.inputs)) {
    const bytes = await readFile(new URL(name, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, name);
    inputs[name] = bytes;
}
const bytes = await rebuildDuneViperNoCoil(
    inputs['source-before-remake.glb'],
    JSON.parse(gunzipSync(inputs['authored-geometry.json.gz'])),
    inputs['lean-texture.webp'],
);
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, manifest.sourceCandidateSha256);
const path = new URL('../public/pet-models/roster/rare-6.glb', import.meta.url);
if (process.argv.includes('--check')) assert.ok(bytes.equals(await readFile(path)), 'Remade Viper differs from its authored inputs');
else await writeFile(path, bytes);
console.log(JSON.stringify({id: 'rare-6', sha256, bytes: bytes.length, checked: process.argv.includes('--check')}));
