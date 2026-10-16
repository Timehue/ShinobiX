// Finalize generated idle poses for deployment.
//
//   asset-gen-out/pet-poses-all/<id>-idle.webp  (staging, 512²)
//     → downscale → public/pet-poses/<id>-idle.webp  (served static)
//
// The game loads only `<id>-idle.webp` (see `hasPetPose` / `petPoseImage`), so
// the other sliced frames stay in staging. Non-destructive: it only writes the
// ids that are staged, so finalizing a few new pets keeps every existing pose.
// The poses are loaded ON-DEMAND per pet, NOT bundled into the JS.
// Run from shinobij.client/:  node scripts/finalize-pet-poses.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const STAGE = path.join(CLIENT, 'asset-gen-out', 'pet-poses-all');
const PUB = path.join(CLIENT, 'public', 'pet-poses');
const SIZE = 384;   // downscaled from 512 — plenty at battle scale, ~half the bytes

fs.mkdirSync(PUB, { recursive: true });
const files = fs.readdirSync(STAGE).filter((f) => /^.+-idle\.webp$/.test(f));
for (const f of files) {
    await sharp(path.join(STAGE, f)).resize(SIZE, SIZE, { fit: 'inside' }).webp({ quality: 86 }).toFile(path.join(PUB, f));
}
console.log(`finalized ${files.length} idle poses @ ${SIZE}px → public/pet-poses`);
