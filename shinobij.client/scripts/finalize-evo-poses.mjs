// Non-destructive finalize for the evolved-starter pose frames.
//
// Downscales asset-gen-out/pet-poses-all/<id>-<cat>.webp → public/pet-poses/ at
// 384px AND MERGES those ids into src/assets/coliseum/pet-poses-manifest.ts
// (POSED_PET_IDS / POSED_RUN_IDS) WITHOUT regenerating the manifest from
// scratch. Unlike finalize-pet-poses.mjs — which rebuilds the manifest purely
// from the (often-empty) staging dir and would therefore DROP the ~148 already-
// shipped pets — this one unions the new ids onto whatever the manifest already
// lists. Safe to run with only the 10 evolution forms staged.
//
//   node scripts/finalize-evo-poses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const STAGE = path.join(CLIENT, 'asset-gen-out', 'pet-poses-all');
const PUB = path.join(CLIENT, 'public', 'pet-poses');
const MANIFEST = path.join(CLIENT, 'src', 'assets', 'coliseum', 'pet-poses-manifest.ts');
const SIZE = 384;

fs.mkdirSync(PUB, { recursive: true });
const files = fs.readdirSync(STAGE).filter((f) => /-(idle|attack|hurt|cast|run-a|run-b)\.webp$/.test(f));
const ids = new Set();
const runFrames = new Map();
let n = 0;
for (const f of files) {
    const m = f.match(/^(.+)-(idle|attack|hurt|cast|run-a|run-b)\.webp$/);
    if (!m) continue;
    const [, id, cat] = m;
    if (cat === 'idle') ids.add(id);
    if (cat === 'run-a' || cat === 'run-b') { if (!runFrames.has(id)) runFrames.set(id, new Set()); runFrames.get(id).add(cat); }
    await sharp(path.join(STAGE, f)).resize(SIZE, SIZE, { fit: 'inside' }).webp({ quality: 86 }).toFile(path.join(PUB, f));
    n++;
}
const newCombat = [...ids];
const newRun = [...runFrames.entries()].filter(([, s]) => s.has('run-a') && s.has('run-b')).map(([id]) => id);

function mergeSet(src, varName, add) {
    const re = new RegExp(`(${varName}: ReadonlySet<string> = new Set\\()(\\[[^\\]]*\\])(\\))`);
    if (!re.test(src)) throw new Error(`could not find ${varName} in manifest`);
    return src.replace(re, (_m, p1, arr, p3) => {
        const set = new Set(JSON.parse(arr));
        add.forEach((x) => set.add(x));
        return p1 + JSON.stringify([...set].sort()) + p3;
    });
}

let src = fs.readFileSync(MANIFEST, 'utf8');
src = mergeSet(src, 'POSED_PET_IDS', newCombat);
src = mergeSet(src, 'POSED_RUN_IDS', newRun);
fs.writeFileSync(MANIFEST, src);
console.log(`merged ${newCombat.length} combat + ${newRun.length} run ids; copied ${n} frames @ ${SIZE}px → public/pet-poses`);
