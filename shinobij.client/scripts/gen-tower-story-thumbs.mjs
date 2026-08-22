/*
 * Regenerate the Battle Towers floor-card thumbnails.
 *
 * The Story Tower lobby lists every catalog floor as a 44x44 icon (see
 * .tower-story-floor-icon in src/styles/tower-lobby.css). Pointing those icons at
 * the 1536x1024 masters made the lobby pull ~4.3 MB of art and hold ~94 MB of
 * decoded bitmaps just to paint fifteen thumbnails, which stalled the main thread
 * on entry. The masters are still the right source for the chapter headers and the
 * selected-floor briefing hero, so they stay untouched; only the icon strip moves
 * to these downscaled copies.
 *
 * Run after adding or re-rendering any story master:
 *   node scripts/gen-tower-story-thumbs.mjs
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// 240x160 keeps the certified 3:2 framing and still covers a 44px box at 3x DPR.
const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 160;

const storyDir = fileURLToPath(new URL('../src/assets/towers/story/', import.meta.url));
const keyArt = fileURLToPath(new URL('../src/assets/towers/battle-towers-key-art-v1.webp', import.meta.url));
const citadel = fileURLToPath(new URL('../src/assets/towers/stormglass-citadel.webp', import.meta.url));
const outDir = fileURLToPath(new URL('../src/assets/towers/thumbs/', import.meta.url));

async function emit(sourcePath, outName) {
    const buffer = await sharp(readFileSync(sourcePath))
        .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
        .webp({ quality: 78, effort: 6 })
        .toBuffer();
    writeFileSync(join(outDir, outName), buffer);
    return buffer.length;
}

mkdirSync(outDir, { recursive: true });

const masters = readdirSync(storyDir).filter(name => name.endsWith('.webp')).sort();
let total = 0;
for (const name of masters) {
    total += await emit(join(storyDir, name), name);
}
// The fallback icon for a floor the catalog ships without authored art.
total += await emit(keyArt, 'key-art.webp');
// Chapter 2 owns a panoramic header rather than a floor master; it needs an icon too.
total += await emit(citadel, 'stormglass-citadel.webp');

console.log(`wrote ${masters.length + 2} thumbnails (${(total / 1024).toFixed(0)} KiB total) to src/assets/towers/thumbs/`);
