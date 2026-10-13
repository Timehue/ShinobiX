// Phone-sized copies of the sector floor paintings for the Mission Hall field
// cards. On a phone a card shows its sector at 68x82 CSS px, but it used to
// fetch the 1024 px painting (~250 KB) for each of ~14 cards. The card offers
// these 256 px copies through srcset; desktop cards still pick the painting.
//
// Each copy is named after the first 12 hex digits of its painting's reviewed
// SHA-256 (shared/sector-floor-layout-data.json `floors`), so a repainted
// sector gets a new URL, and gen-sector-map-thumbs.test.mjs fails until the
// copies are regenerated:
//   node scripts/gen-sector-map-thumbs.mjs      (run from shinobij.client/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_ROOT = path.resolve(HERE, '..');
export const FLOOR_DIR = path.join(CLIENT_ROOT, 'public', 'sector-map');
export const THUMB_DIR = path.join(FLOOR_DIR, 'thumbs');
export const THUMB_PX = 256;

/** artKey -> reviewed SHA-256 of public/sector-map/s<artKey>.webp */
export function floorArtHashes() {
    const data = JSON.parse(fs.readFileSync(path.join(CLIENT_ROOT, '..', 'shared', 'sector-floor-layout-data.json'), 'utf8'));
    return new Map(Object.entries(data.floors));
}

export function thumbFileName(artKey, sha256) {
    return `s${artKey}-${String(sha256).slice(0, 12)}.webp`;
}

async function main() {
    const { default: sharp } = await import('sharp');
    sharp.cache(false);
    fs.mkdirSync(THUMB_DIR, { recursive: true });
    const wanted = new Set();
    let before = 0, after = 0;
    for (const [artKey, sha256] of floorArtHashes()) {
        const name = thumbFileName(artKey, sha256);
        wanted.add(name);
        const source = fs.readFileSync(path.join(FLOOR_DIR, `s${artKey}.webp`));
        const thumb = await sharp(source)
            .resize(THUMB_PX, THUMB_PX, { fit: 'inside', kernel: 'lanczos3' })
            .webp({ quality: 80, effort: 6, smartSubsample: true })
            .toBuffer();
        fs.writeFileSync(path.join(THUMB_DIR, name), thumb);
        before += source.length;
        after += thumb.length;
    }
    const stale = fs.readdirSync(THUMB_DIR).filter((file) => !wanted.has(file));
    for (const file of stale) fs.rmSync(path.join(THUMB_DIR, file));
    console.log(`${wanted.size} thumbnails: ${before} -> ${after} B${stale.length ? `; removed ${stale.length} stale` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
