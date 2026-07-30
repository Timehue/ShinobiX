/*
 * Shrine standee QA composites — renders each shrine standee onto its (new)
 * floor at the EXACT sector-board CSS math (left/top %, translate(-50%,-62%),
 * width 14%) so a reviewer can verify the restyled floor still gives the
 * standee open, walkable-reading ground (and no painted shrine duplicates it).
 *
 * Sharp gotcha (July): composite at FULL floor resolution, then resize —
 * compositing after a resize mispositions the overlay.
 *
 * Usage: node scripts/shrine-qa-composites.mjs [--out <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_DIR = path.join(CLIENT, 'public', 'sector-map');
const LANDMARKS_DIR = path.join(CLIENT, 'public', 'landmarks');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = arg('out', path.join(os.tmpdir(), 'shrine-qa'));
fs.mkdirSync(OUT, { recursive: true });

// id → { artKey (floor file), left/top % } — mirrors shared/shrines.ts (which
// keys by CURRENT sector number; the FLOOR FILES are keyed by artKey).
const SHRINES = [
    { id: 'heartwood', artKey: 42, left: 54, top: 44 },
    { id: 'tide', artKey: 34, left: 13, top: 68 },
    { id: 'frostveil', artKey: 53, left: 26, top: 45 },
    { id: 'moonwell', artKey: 16, left: 60, top: 74 },
    { id: 'hollowgate', artKey: 13, left: 58, top: 70 },
    { id: 'ancients', artKey: 10, left: 48, top: 45 },
];

const { default: sharp } = await import('sharp');

for (const shrine of SHRINES) {
    const floorPath = path.join(FLOORS_DIR, `s${shrine.artKey}.webp`);
    const standeePath = path.join(LANDMARKS_DIR, `shrine-${shrine.id}.webp`);
    if (!fs.existsSync(floorPath) || !fs.existsSync(standeePath)) {
        console.log(`skip ${shrine.id} — missing floor or standee`);
        continue;
    }
    const floor = sharp(floorPath);
    const { width: fw, height: fh } = await floor.metadata();
    const standeeW = Math.round(fw * 0.14);
    const standee = await sharp(standeePath).resize(standeeW, null).toBuffer();
    const { height: sh } = await sharp(standee).metadata();
    const left = Math.round((shrine.left / 100) * fw - standeeW / 2);
    const top = Math.round((shrine.top / 100) * fh - 0.62 * sh);
    const composite = await floor
        .composite([{ input: standee, left: Math.max(0, left), top: Math.max(0, top) }])
        .webp({ quality: 80 })
        .toBuffer();
    const out = path.join(OUT, `${shrine.id}-s${shrine.artKey}.webp`);
    fs.writeFileSync(out, composite);
    console.log(out);
}
console.log('done');
