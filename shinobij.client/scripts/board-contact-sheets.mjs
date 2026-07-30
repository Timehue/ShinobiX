/*
 * QA contact sheets for the board-style floor fleet: tiles all 66 floors into
 * labeled grids (10 per sheet) so a reviewer can spot style outliers, vista
 * drift, staffage, text, or missing walkable lanes at a glance.
 * Sheets land in the system temp dir (they are review artifacts, not assets).
 *
 * Usage: node scripts/board-contact-sheets.mjs [--out <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTOR_ART } from './sector-art-data.mjs';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_DIR = path.join(CLIENT, 'public', 'sector-map');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = arg('out', path.join(os.tmpdir(), 'board-sheets'));
fs.mkdirSync(OUT, { recursive: true });

const { default: sharp } = await import('sharp');

const TILE = 360;
const LABEL_H = 26;
const COLS = 5;
const ROWS = 2;

const ids = Object.keys(SECTOR_ART).map(Number).sort((a, b) => a - b);

function labelSvg(text) {
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return Buffer.from(
        `<svg width="${TILE}" height="${LABEL_H}"><rect width="100%" height="100%" fill="#14171f"/>` +
        `<text x="6" y="18" font-family="Consolas,monospace" font-size="15" fill="#f2e8cf">${safe}</text></svg>`,
    );
}

let sheetIndex = 0;
for (let start = 0; start < ids.length; start += COLS * ROWS) {
    const batch = ids.slice(start, start + COLS * ROWS);
    const composites = [];
    for (let i = 0; i < batch.length; i++) {
        const n = batch[i];
        const file = path.join(FLOORS_DIR, `s${n}.webp`);
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = col * TILE;
        const y = row * (TILE + LABEL_H);
        if (fs.existsSync(file)) {
            composites.push({ input: await sharp(file).resize(TILE, TILE).toBuffer(), left: x, top: y });
        }
        composites.push({ input: labelSvg(`s${n} ${SECTOR_ART[n].name} [${SECTOR_ART[n].region}]`), left: x, top: y + TILE });
    }
    const sheet = await sharp({
        create: { width: COLS * TILE, height: ROWS * (TILE + LABEL_H), channels: 3, background: '#0c0e14' },
    }).composite(composites).webp({ quality: 80 }).toBuffer();
    const out = path.join(OUT, `sheet-${String(++sheetIndex).padStart(2, '0')}.webp`);
    fs.writeFileSync(out, sheet);
    console.log(out);
}
console.log('done');
