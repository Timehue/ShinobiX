// Non-destructive finalize for the evolved-starter pose frames.
//
// Downscales asset-gen-out/pet-poses-all/<id>-<cat>.webp → public/pet-poses/ at
// 384px, then certifies all three memberships from the complete public pose
// inventory. Existing combat, run, and move frames remain represented even
// when only the 10 evolution forms are staged.
//
//   node scripts/finalize-evo-poses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { syncPetPoseManifest } from './pet-pose-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const STAGE = path.join(CLIENT, 'asset-gen-out', 'pet-poses-all');
const PUB = path.join(CLIENT, 'public', 'pet-poses');
const SIZE = 384;

// Certify compact metadata before any staging read or artwork conversion.
if (process.argv.includes('--manifest-only')) {
    const memberships = syncPetPoseManifest(CLIENT, { checkOnly: process.argv.includes('--check') });
    console.log(`[pose-manifest] ${process.argv.includes('--check') ? 'checked' : 'generated'} all three memberships: ${Object.values(memberships).map(ids => ids.length).join('/')}`);
    process.exit(0);
}

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

const memberships = syncPetPoseManifest(CLIENT);
console.log(`merged ${newCombat.length} combat + ${newRun.length} run ids; copied ${n} frames @ ${SIZE}px → public/pet-poses; complete memberships ${Object.values(memberships).map(ids => ids.length).join('/')}`);
