// Crop the user supplied 3-view Celestial Lion sheet into fal's named views.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'art-source/dawnmane-seraph/reference-views-user.png');
const outputDir = resolve(root, 'art-source/dawnmane-seraph/views-user');
const metadata = await sharp(source).metadata();
if (metadata.width !== 2172 || metadata.height !== 724) {
  throw new Error(`Unexpected Celestial Lion reference size: ${metadata.width}x${metadata.height}`);
}
await mkdir(outputDir, { recursive: true });
// The montage overlaps the neighboring profile's face into the right edge of
// the front panel. Clear only that intrusion for the model's front input.
const { data, info } = await sharp(source)
  .extract({ left: 0, top: 0, width: 724, height: 724 })
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let y = 0; y < 320; y += 1) {
  for (let x = 660; x < 724; x += 1) {
    data[(y * info.width + x) * info.channels + 3] = 0;
  }
}
const cleanFront = resolve(outputDir, 'front-clean.png');
await sharp(data, { raw: info }).png().toFile(cleanFront);
console.log(`front-clean: ${cleanFront}`);
