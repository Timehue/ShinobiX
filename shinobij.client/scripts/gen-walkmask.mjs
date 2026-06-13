// Walkability-mask generator for the tactical diorama. Pets may only stand on
// STONE PATHS + WOODEN BRIDGES; grass/clumps, water, seals, walls, structures and
// shadow are blocked. Classifies the painting's pixels over a field grid (field →
// a map-space rectangle) and bakes a packed 0/1 mask the sims pathfind on, plus a
// debug overlay PNG (walkable = green, blocked = red).
//
//   node scripts/gen-walkmask.mjs                              # band (duel)  → pet-arena-walkmask.ts
//   node scripts/gen-walkmask.mjs --full                      # full arena (arena mode) → pet-arena-fullmask.ts
//   node scripts/gen-walkmask.mjs --region x0,x1,y0,y1 --grid cols,rows --out file.ts --prefix WALK --debug name.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const SRC = path.join(CLIENT, 'src', 'assets', 'coliseum', 'tactics-diorama.webp');
const MAP_W = 1536, MAP_H = 1024;
const ARENA_X = 14.0, ARENA_Y = 7.5;
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };

// Default = the lower "action band" (duel mode). --full = the whole inner arena
// (arena mode: reaches all four corner spawn seals + the center).
const full = process.argv.includes('--full');
const region = (arg('region', full ? '150,1386,96,930' : '292,1244,452,800')).split(',').map(Number);
const grid = (arg('grid', full ? '112,74' : '96,46')).split(',').map(Number);
const OUT = path.join(CLIENT, 'src', 'lib', arg('out', full ? 'pet-arena-fullmask.ts' : 'pet-arena-walkmask.ts'));
const PREFIX = arg('prefix', full ? 'FULL' : 'WALK');
const DEBUG = path.join(CLIENT, 'asset-gen-out', arg('debug', full ? 'fullmask-debug.png' : 'walkmask-debug.png'));
const PLAY = { x0: region[0], x1: region[1], y0: region[2], y1: region[3] };
const GCOLS = grid[0], GROWS = grid[1];

const lerp = (a, b, t) => a + (b - a) * t;
function fieldCellToImage(c, r) {
    const fx = (c + 0.5) / GCOLS * (2 * ARENA_X) - ARENA_X;
    const fy = (r + 0.5) / GROWS * (2 * ARENA_Y) - ARENA_Y;
    return [lerp(PLAY.x0, PLAY.x1, (fx + ARENA_X) / (2 * ARENA_X)), lerp(PLAY.y0, PLAY.y1, (fy + ARENA_Y) / (2 * ARENA_Y))];
}
function isWalkable(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (g >= r && g > b + 10 && g > 60) return false;   // green grass / foliage clump
    if (b > r + 8 && b > g + 4) return false;            // blue water / magic seal
    if (mx < 52) return false;                           // deep shadow / wall / structure
    if (mn > 212) return false;                          // bright lantern glint
    return mx >= 52 && r >= b - 6;                       // warm grey stone OR brown bridge
}

const { data, info } = await sharp(SRC).resize(MAP_W, MAP_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const px = (x, y) => { const i = (Math.min(MAP_H - 1, Math.max(0, y | 0)) * MAP_W + Math.min(MAP_W - 1, Math.max(0, x | 0))) * ch; return [data[i], data[i + 1], data[i + 2]]; };

const walk = [];
for (let r = 0; r < GROWS; r++) {
    walk[r] = [];
    for (let c = 0; c < GCOLS; c++) {
        const [mx, my] = fieldCellToImage(c, r);
        let yes = 0, tot = 0;
        for (let oy = -3; oy <= 3; oy += 3) for (let ox = -4; ox <= 4; ox += 4) { const [R, G, B] = px(mx + ox, my + oy); tot++; if (isWalkable(R, G, B)) yes++; }
        walk[r][c] = yes * 2 >= tot;
    }
}
// Dilate once — widen thin painted paths + close 1-cell gaps so the web is fully
// CONNECTED (pets must route between any two spawns) with room for a body.
for (let pass = 0; pass < 1; pass++) {
    const prev = walk.map((row) => row.slice());
    for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) { if (prev[r][c]) continue; if (prev[r - 1]?.[c] || prev[r + 1]?.[c] || prev[r][c - 1] || prev[r][c + 1]) walk[r][c] = true; }
}
// Carve ENTRANCES into the center (the painted ring around the paw blocks the
// scroll spawn). One from the north, one from the south, plus a small plaza so
// the objective is reachable. (--full only.)
if (full) {
    const carve = (x0, y0, x1, y1, w) => {
        const steps = 64;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps, fx = x0 + (x1 - x0) * t, fy = y0 + (y1 - y0) * t;
            const c = Math.floor((fx + ARENA_X) / (2 * ARENA_X) * GCOLS), r = Math.floor((fy + ARENA_Y) / (2 * ARENA_Y) * GROWS);
            for (let dr = -w; dr <= w; dr++) for (let dc = -w; dc <= w; dc++) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < GCOLS && rr < GROWS) walk[rr][cc] = true; }
        }
    };
    const cy = -1.1;            // scroll spawn = painted center paw (see find-seals.mjs)
    carve(0, cy, 0, cy, 2);     // center plaza (scroll spawn)
    carve(0, cy, 0, -7.2, 1);   // north entrance (up)
    carve(0, cy, 0, 7.2, 1);    // south entrance (down)
}
let bits = '', walkN = 0;
for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) { const w = walk[r][c]; bits += w ? '1' : '0'; if (w) walkN++; }
// connectivity report
const seen = new Set(); let best = 0;
for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) {
    if (!walk[r][c] || seen.has(r * GCOLS + c)) continue;
    let n = 0; const st = [[c, r]]; seen.add(r * GCOLS + c);
    while (st.length) { const [cc, cr] = st.pop(); n++; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = cc + dc, nr = cr + dr; if (nc >= 0 && nr >= 0 && nc < GCOLS && nr < GROWS && walk[nr][nc] && !seen.has(nr * GCOLS + nc)) { seen.add(nr * GCOLS + nc); st.push([nc, nr]); } } }
    best = Math.max(best, n);
}

fs.writeFileSync(OUT, `// AUTO-GENERATED by scripts/gen-walkmask.mjs from tactics-diorama.webp.\n// Walkable (stone paths + bridges) = '1', blocked = '0'; row-major over a field\n// grid (${PREFIX}_COLS×${PREFIX}_ROWS) that maps to the [${PLAY.x0},${PLAY.x1}]×[${PLAY.y0},${PLAY.y1}] px region of the 1536×1024 art.\nexport const ${PREFIX}_COLS = ${GCOLS};\nexport const ${PREFIX}_ROWS = ${GROWS};\nexport const ${PREFIX}_MASK = "${bits}";\n`);

const overlay = Buffer.alloc(MAP_W * MAP_H * 4, 0);
for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) {
    const w = bits[r * GCOLS + c] === '1';
    const x0 = Math.round(lerp(PLAY.x0, PLAY.x1, c / GCOLS)), x1 = Math.round(lerp(PLAY.x0, PLAY.x1, (c + 1) / GCOLS));
    const y0 = Math.round(lerp(PLAY.y0, PLAY.y1, r / GROWS)), y1 = Math.round(lerp(PLAY.y0, PLAY.y1, (r + 1) / GROWS));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * MAP_W + x) * 4; overlay[i] = w ? 0 : 255; overlay[i + 1] = w ? 255 : 0; overlay[i + 2] = 0; overlay[i + 3] = 85; }
}
await sharp(SRC).resize(MAP_W, MAP_H, { fit: 'fill' }).composite([{ input: overlay, raw: { width: MAP_W, height: MAP_H, channels: 4 } }]).png().toFile(DEBUG);
console.log(`${PREFIX} mask ${GCOLS}×${GROWS}: ${walkN}/${GCOLS * GROWS} walkable (${(walkN / (GCOLS * GROWS) * 100).toFixed(0)}%), largest component ${best} (${(best / walkN * 100).toFixed(0)}%) → ${path.relative(CLIENT, OUT)}; overlay → ${path.relative(CLIENT, DEBUG)}`);
