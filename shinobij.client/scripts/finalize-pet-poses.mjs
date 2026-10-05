// Finalize the generated pose flipbook for deployment.
//
//   asset-gen-out/pet-poses-all/<id>-{idle,attack,hurt,cast}.webp  (staging, 512²)
//     → downscale → public/pet-poses/<id>-<cat>.webp                (served static)
//     → src/assets/coliseum/pet-poses-manifest.ts                   (which ids have poses)
//
// The poses are served as STATIC files (public/) and loaded ON-DEMAND per
// fighting pet by the renderer — NOT bundled into the JS, so 148 pets don't
// bloat the app. Run from shinobij.client/:  node scripts/finalize-pet-poses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { syncPetPoseManifest } from './pet-pose-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const STAGE = path.join(CLIENT, 'asset-gen-out', 'pet-poses-all');
const PUB = path.join(CLIENT, 'public', 'pet-poses');
const SIZE = 384;   // downscaled from 512 — plenty at battle scale, ~half the bytes

// Metadata-only certification never reads staging inputs or rewrites artwork.
if (process.argv.includes('--manifest-only')) {
    const memberships = syncPetPoseManifest(CLIENT, { checkOnly: process.argv.includes('--check') });
    console.log(`[pose-manifest] ${process.argv.includes('--check') ? 'checked' : 'generated'} all three memberships: ${Object.values(memberships).map(ids => ids.length).join('/')}`);
    process.exit(0);
}

fs.mkdirSync(PUB, { recursive: true });
const files = fs.readdirSync(STAGE).filter((f) => /-(idle|attack|hurt|cast|run-a|run-b)\.webp$/.test(f));
const ids = new Set();                 // ids with the 4-pose combat sheet
const runFrames = new Map();           // id → Set of run cats present (need both run-a & run-b)
let n = 0;
for (const f of files) {
    const m = f.match(/^(.+)-(idle|attack|hurt|cast|run-a|run-b)\.webp$/);
    if (!m) continue;
    const [, id, cat] = m;
    if (cat === 'idle') ids.add(id); // 'idle' presence flags a complete combat set
    if (cat === 'run-a' || cat === 'run-b') { if (!runFrames.has(id)) runFrames.set(id, new Set()); runFrames.get(id).add(cat); }
    await sharp(path.join(STAGE, f)).resize(SIZE, SIZE, { fit: 'inside' }).webp({ quality: 86 }).toFile(path.join(PUB, f));
    n++;
}
const memberships = syncPetPoseManifest(CLIENT);
console.log(`finalized ${memberships.POSED_PET_IDS.length} combat sets + ${memberships.POSED_RUN_IDS.length} run cycles (${n} frames) @ ${SIZE}px → public/pet-poses; complete manifest written`);
