// One-off: locate the 4 spawn seals + the center paw in tactics-diorama.webp and
// print their FIELD coordinates (matching arenaPlace / ARENA_X,Y) so the sim's
// SEALS + scroll center land exactly on the painted art. Run: node scripts/find-seals.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src', 'assets', 'coliseum', 'tactics-diorama.webp');
const MAP_W = 1536, MAP_H = 1024;
const ARENA_X = 14.0, ARENA_Y = 7.5;
// arenaPlace region (must match PetColiseum ARENA_PLAY + gen-walkmask --full region)
const PLAY = { x0: 150, x1: 1386, y0: 96, y1: 930 };

const { data, info } = await sharp(SRC).resize(MAP_W, MAP_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const at = (x, y) => { const i = (y * MAP_W + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };

// Centroid of pixels matching `hit` inside a rectangular window.
function centroid(hit, x0, x1, y0, y1) {
    let sx = 0, sy = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const [r, g, b] = at(x, y); if (hit(r, g, b)) { sx += x; sy += y; n++; } }
    return n ? [sx / n, sy / n, n] : null;
}
const toField = (mx, my) => [
    (mx - PLAY.x0) / (PLAY.x1 - PLAY.x0) * (2 * ARENA_X) - ARENA_X,
    (my - PLAY.y0) / (PLAY.y1 - PLAY.y0) * (2 * ARENA_Y) - ARENA_Y,
];
const f2 = (v) => v.toFixed(2);

const blue = (r, g, b) => b > r + 28 && b > g + 16 && b > 70;             // cyan/blue magic seal
const red = (r, g, b) => r > g + 45 && r > b + 35 && r > 90;              // red/orange magic seal

// Quadrant windows (avoid the bright walls at the very edges).
const Q = {
    'blue TL': centroid(blue, 180, 520, 110, 380),
    'blue BL': centroid(blue, 130, 470, 560, 830),
    'red  TR': centroid(red, 1020, 1360, 110, 380),
    'red  BR': centroid(red, 1040, 1380, 540, 830),
};
// Center paw: reddish paw print on the lighter central pad.
const paw = centroid(red, 690, 850, 360, 560);

for (const [k, v] of Object.entries(Q)) {
    if (!v) { console.log(`${k}: NOT FOUND`); continue; }
    const [fx, fy] = toField(v[0], v[1]);
    console.log(`${k}: px(${v[0] | 0},${v[1] | 0}) n=${v[2]}  ->  field(${f2(fx)}, ${f2(fy)})`);
}
if (paw) { const [fx, fy] = toField(paw[0], paw[1]); console.log(`center paw: px(${paw[0] | 0},${paw[1] | 0}) n=${paw[2]}  ->  field(${f2(fx)}, ${f2(fy)})`); }
