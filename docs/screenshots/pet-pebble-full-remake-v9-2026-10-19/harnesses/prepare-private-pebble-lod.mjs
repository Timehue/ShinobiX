// Adapt the shipping simplifier only to a one-asset private directory. Geometry,
// skin metrics, bounds, texture and silhouette thresholds are left unchanged.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const client=resolve('.'),base=resolve('.tmp/pebble-full-remake/delivery'),pub=resolve(base,'public'),model=resolve(pub,'pet-models');
await mkdir(resolve(model,'warfront-lod'),{recursive:true});await copyFile('.tmp/pebble-full-remake/pebble-remade-private.glb',resolve(model,'starter-earth.glb'));
await writeFile(resolve(model,'warfront-lod/manifest.json'),JSON.stringify({entries:[]}));
let s=await readFile('scripts/generate-warfront-pet-lods.mjs','utf8');const originalSha256=createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
s=s.replace('"./lib/pet-lod-skin-palette.mjs"','"../scripts/lib/pet-lod-skin-palette.mjs"');
s=s.replace('const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");','const clientRoot = '+JSON.stringify(client)+';');
s=s.replace('const publicRoot = resolve(clientRoot, "public");','const publicRoot = '+JSON.stringify(pub)+';');
s=s.replace('const tsManifestPath = resolve(clientRoot, "src/generated/pet-warfront-lod-manifest.ts");','const tsManifestPath = '+JSON.stringify(resolve(base,'pet-warfront-lod-manifest.ts'))+';');
s=s.replace(/const EXPECTED_RUNTIME_SOURCE_COUNT = \d+;/,'const EXPECTED_RUNTIME_SOURCE_COUNT = 1;');
s=s.replace('async function existingRuntimeSources() {','async function existingRuntimeSources() { return [resolve(modelRoot,"starter-earth.glb")];\n}\nasync function unusedFullRosterInventory() {');
// New sculpt-specific patches: keep the independently marked complete chin and
// crown, and the visibly jagged wrist/ankle cloth surfaces. No old scalp mask.
const preservation=[[-.22,.22,.55,.99,-.06,.38],[-.115,.115,-.18,.05,.37,.565],[-.60,.60,-.12,.32,.34,.82],[-.75,-.40,-.43,-.37,0,.335],[.40,.75,-.43,-.37,0,.335],[-.49,-.15,-.866,-.818,-.085,.245],[.15,.49,-.866,-.818,-.085,.245],[-.49,-.30,-.41,-.19,-.14,.18],[.30,.49,-.41,-.19,-.14,.18]];
s=s.replace('REVIEWED_DEFORMATION_LOCKS[slash(relative(modelRoot, sourcePath))] ?? []',JSON.stringify(preservation));
await writeFile('.tmp/generate-pebble-remade-private-lod.mjs',s);
await writeFile(resolve(base,'private-generator-provenance.json'),JSON.stringify({originalSha256,original:'scripts/generate-warfront-pet-lods.mjs',scope:'Private one-model directory only',changes:['paths isolated','one asset inventory','obsolete scalp locks replaced with reviewed new chin/crown and visibly jagged cloth patches'],preservation,shippingThresholdsUnchanged:true,acceptance:'unreviewed'},null,2));
