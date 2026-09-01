/*
 * Generate storefront product art for the Tebex packages.
 *
 *   node scripts/gen-store-art.mjs [outDir]
 *
 * Composites the game's own key art with a title plate, so every package card
 * looks like the same product family. Deliberately built from assets we own:
 * a store listing is the most public surface the game has, and licensed or
 * fan-made art there risks the storefront and the Play listing together.
 *
 * Text is drawn with a system serif rather than the self-hosted Marcellus face.
 * librsvg (what sharp renders SVG through) does not reliably honour @font-face
 * with a woff2, so a webfont here silently falls back and shifts the layout.
 * Georgia is present on Windows and macOS and degrades to a generic serif
 * elsewhere, which is a smaller failure than a broken glyph run.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'shinobij.client', 'public');
const OUT_DIR = process.argv[2] ?? join(HERE, '..', 'store-art');

const WIDTH = 1024;
const HEIGHT = 576;

/** Veiled Steel accents — matches the in-game supporter card and boot splash. */
const GOLD = '#e8c26a';
const INK = '#0b1120';

function escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, (c) => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
    ));
}

/**
 * A title plate: a bottom scrim so the art never fights the text, a hairline
 * gold rule, then the name and a short qualifier.
 */
function overlaySvg(title, subtitle) {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="${INK}" stop-opacity="0"/>
      <stop offset="45%" stop-color="${INK}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${INK}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#scrim)"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="none" stroke="${GOLD}" stroke-opacity="0.45" stroke-width="3"/>
  <line x1="${WIDTH / 2 - 150}" y1="${HEIGHT - 168}" x2="${WIDTH / 2 + 150}" y2="${HEIGHT - 168}" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="2"/>
  <text x="${WIDTH / 2}" y="${HEIGHT - 104}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-size="62" letter-spacing="6"
        fill="#ffffff" stroke="${INK}" stroke-width="6" paint-order="stroke">${escapeXml(title)}</text>
  <text x="${WIDTH / 2}" y="${HEIGHT - 56}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-size="26" letter-spacing="9"
        fill="${GOLD}">${escapeXml(subtitle)}</text>
</svg>`);
}

const CARDS = [
    { file: 'shinobi-supporter.png', base: 'Shinobi-Journeys.png', title: 'SHINOBI SUPPORTER', subtitle: 'MONTHLY SUPPORT' },
    { file: 'fate-shards-35.png', base: 'Shinobi-Journeys.png', title: '35 FATE SHARDS', subtitle: 'PREMIUM CURRENCY' },
    { file: 'fate-shards-155.png', base: 'Shinobi-Journeys.png', title: '155 FATE SHARDS', subtitle: '10% MORE PER DOLLAR' },
    { file: 'fate-shards-420.png', base: 'Shinobi-Journeys.png', title: '420 FATE SHARDS', subtitle: '19% MORE PER DOLLAR' },
    { file: 'fate-shards-900.png', base: 'Shinobi-Journeys.png', title: '900 FATE SHARDS', subtitle: '28% MORE PER DOLLAR' },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const card of CARDS) {
    await sharp(join(PUBLIC_DIR, card.base))
        .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
        .composite([{ input: overlaySvg(card.title, card.subtitle), top: 0, left: 0 }])
        .png({ compressionLevel: 9 })
        .toFile(join(OUT_DIR, card.file));
    console.log(`[store-art] ${card.file}  ${card.title}`);
}

console.log(`[store-art] ${CARDS.length} cards written to ${OUT_DIR}`);
