/*
 * Generate the PWA / TWA launcher icons from the single source of truth,
 * shinobij.client/public/shinobi-journey-mark-512-v3.png.
 *
 *   node scripts/gen-pwa-icons.mjs
 *
 * Why these four:
 *  - icon-192.png / icon-512.png  → `purpose: "any"` in the web manifest. 192 is
 *    the legacy Android launcher size, 512 is what Play and the install prompt
 *    read. Both are painted on the brand background because a transparent
 *    launcher icon renders as a floating glyph on whatever the launcher wants.
 *  - icon-maskable-512.png        → `purpose: "maskable"`. Android crops icons
 *    to the device's mask (circle, squircle, teardrop). Only the inner ~80% of
 *    the canvas is guaranteed visible, so the glyph is drawn at MASKABLE_SCALE
 *    to sit well inside the safe zone. Reusing the "any" icon here is the
 *    classic bug: the mask eats the edges of the mark.
 *  - apple-touch-icon.png         → iOS home-screen, which ignores the manifest
 *    icons and has no maskable concept (it applies its own rounding).
 *
 * The TWA reads these through the manifest, so regenerate and rebuild after any
 * favicon change or the launcher icon silently drifts from the site.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'shinobij.client', 'public');
const SOURCE = join(PUBLIC_DIR, 'shinobi-journey-mark-512-v3.png');

/** Brand background — matches <meta name="theme-color"> and the boot splash. */
const BACKGROUND = { r: 15, g: 23, b: 42, alpha: 1 }; // #0f172a

/** Glyph size as a fraction of the canvas, per purpose. */
const ANY_SCALE = 0.68;
const MASKABLE_SCALE = 0.54;

const TARGETS = [
    { file: 'icon-192.png', size: 192, scale: ANY_SCALE },
    { file: 'icon-512.png', size: 512, scale: ANY_SCALE },
    { file: 'icon-maskable-512.png', size: 512, scale: MASKABLE_SCALE },
    { file: 'apple-touch-icon.png', size: 180, scale: ANY_SCALE },
];

const sourceMark = readFileSync(SOURCE);

for (const { file, size, scale } of TARGETS) {
    // Resize the transparent master at the glyph size, then centre it on the
    // solid canvas. `fit: 'contain'` preserves its square composition.
    const glyphSize = Math.round(size * scale);
    const glyph = await sharp(sourceMark)
        .resize(glyphSize, glyphSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
        .composite([{ input: glyph, gravity: 'centre' }])
        .png({ compressionLevel: 9 })
        .toFile(join(PUBLIC_DIR, file));

    console.log(`[pwa-icons] wrote ${file} (${size}x${size}, glyph ${glyphSize}px)`);
}

console.log(`[pwa-icons] done — ${TARGETS.length} icons in shinobij.client/public/`);
