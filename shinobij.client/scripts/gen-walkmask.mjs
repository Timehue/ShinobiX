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
// --mask-src <file> : classify walkability from a HIGHLIGHT image (the walkways
// painted as a glowing gold web) instead of the dark display art. The display art
// (SRC) is unchanged and is still what the debug overlay is composited over, so we
// can confirm the gold-derived mask lines up with what players actually see.
const MASK_SRC = arg('mask-src', null);
// --overlay <file> : composite the debug overlay over THIS image (e.g. the gold
// highlight) instead of the display art, to confirm the mask traces the source paths.
const OVERLAY_SRC = arg('overlay', null);
const PLAY = { x0: region[0], x1: region[1], y0: region[2], y1: region[3] };
const GCOLS = grid[0], GROWS = grid[1];

const lerp = (a, b, t) => a + (b - a) * t;
function fieldCellToImage(c, r) {
    const fx = (c + 0.5) / GCOLS * (2 * ARENA_X) - ARENA_X;
    const fy = (r + 0.5) / GROWS * (2 * ARENA_Y) - ARENA_Y;
    return [lerp(PLAY.x0, PLAY.x1, (fx + ARENA_X) / (2 * ARENA_X)), lerp(PLAY.y0, PLAY.y1, (fy + ARENA_Y) / (2 * ARENA_Y))];
}
// Legacy COLOR classifier (used when no --mask-src highlight is given): warm grey
// stone / brown bridge = walkable; grass / water / shadow / glint = blocked. The
// dark display art has no clean stone/grass colour split, so this floods badly —
// prefer --mask-src for the arena.
function isCementColor(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (g >= r && g > b + 10 && g > 60) return false;   // green grass / foliage clump
    if (b > r + 8 && b > g + 4) return false;            // blue water / magic seal
    if (mx < 52) return false;                           // deep shadow / wall / structure
    if (mn > 212) return false;                          // bright lantern glint
    return mx >= 52 && r >= b - 6;                       // warm grey stone OR brown bridge
}
// Highlight classifier (--mask-src): the walkways are painted as a glowing GOLD
// web — yellow (R,G high, B much lower) + bright. A cell is walkable when a small
// fraction of a window around it is gold, so thin spokes still register.
const isGold = (r, g, b) => (Math.min(r, g) - b) >= 45 && (r + g) / 2 >= 110;

// Classification reads MASK_SRC (the highlight) when given, else the display art.
const maskSrc = MASK_SRC ? path.join(CLIENT, 'src', 'assets', 'coliseum', MASK_SRC) : SRC;
const { data, info } = await sharp(maskSrc).resize(MAP_W, MAP_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const px = (x, y) => { const i = (Math.min(MAP_H - 1, Math.max(0, y | 0)) * MAP_W + Math.min(MAP_W - 1, Math.max(0, x | 0))) * ch; return [data[i], data[i + 1], data[i + 2]]; };

const walk = [];
for (let r = 0; r < GROWS; r++) {
    walk[r] = [];
    for (let c = 0; c < GCOLS; c++) {
        const [mx, my] = fieldCellToImage(c, r);
        let yes = 0, tot = 0;
        if (MASK_SRC) {
            for (let oy = -5; oy <= 5; oy += 2) for (let ox = -7; ox <= 7; ox += 2) { const [R, G, B] = px(mx + ox, my + oy); tot++; if (isGold(R, G, B)) yes++; }
            walk[r][c] = yes * 100 >= 15 * tot;          // ≥15% of the window is gold path
        } else {
            for (let oy = -3; oy <= 3; oy += 3) for (let ox = -4; ox <= 4; ox += 4) { const [R, G, B] = px(mx + ox, my + oy); tot++; if (isCementColor(R, G, B)) yes++; }
            walk[r][c] = yes * 2 >= tot;
        }
    }
}
// Bridge DEAD-ENDS across thin gaps — done HERE on the un-dilated web, where a spur
// tip is a clean degree-≤1 cell. A path that stops just short of a parallel one makes
// pets walk into it and backtrack; connect each tip to the nearest walkable cell that
// is spatially close but NOT already reachable within a short walk, so ONLY genuine
// near-miss gaps get a 1-wide connector (intelligent: bounded gap + graph-distance
// check skips paths that already loop back nearby; two passes so a bridge can chain).
// (--full / arena only — the duel band doesn't need it.)
if (full) {
    const wk = (c, r) => c >= 0 && r >= 0 && c < GCOLS && r < GROWS && walk[r][c];
    const deg = (c, r) => (wk(c - 1, r) ? 1 : 0) + (wk(c + 1, r) ? 1 : 0) + (wk(c, r - 1) ? 1 : 0) + (wk(c, r + 1) ? 1 : 0);
    const MAX_GAP = 4, NEAR_HOPS = 10;          // gap ≤4 cells (~1.2 field units); skip if target ≤10 walk-steps away
    for (let pass = 0; pass < 2; pass++) {
        const tips = [];
        for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) if (wk(c, r) && deg(c, r) <= 1) tips.push([c, r]);
        for (const [tc, tr] of tips) {
            if (deg(tc, tr) > 1) continue;       // may have been joined earlier this pass
            // flood from the tip over walkable cells up to NEAR_HOPS → "already connected" set
            const near = new Set([tr * GCOLS + tc]); const q = [[tc, tr, 0]]; let qh = 0;
            while (qh < q.length) { const [cc, cr, dd] = q[qh++]; if (dd >= NEAR_HOPS) continue; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = cc + dc, nr = cr + dr; if (wk(nc, nr) && !near.has(nr * GCOLS + nc)) { near.add(nr * GCOLS + nc); q.push([nc, nr, dd + 1]); } } }
            // nearest walkable cell within MAX_GAP that is NOT already-connected
            let bx = -1, by = -1, bd = 1e9;
            for (let dr = -MAX_GAP; dr <= MAX_GAP; dr++) for (let dc = -MAX_GAP; dc <= MAX_GAP; dc++) {
                const nc = tc + dc, nr = tr + dr; if (!wk(nc, nr) || near.has(nr * GCOLS + nc)) continue;
                const d = Math.sqrt(dc * dc + dr * dr); if (d > MAX_GAP || d < 1.01 || d >= bd) continue;
                bd = d; bx = nc; by = nr;
            }
            if (bx < 0) continue;
            const steps = Math.max(2, Math.ceil(bd * 2));   // carve a 1-wide connector tip→target
            for (let i = 0; i <= steps; i++) { const t = i / steps; const cc = Math.round(tc + (bx - tc) * t), rr = Math.round(tr + (by - tr) * t); if (cc >= 0 && rr >= 0 && cc < GCOLS && rr < GROWS) walk[rr][cc] = true; }
        }
    }
}
// Dilate once — widen thin painted paths + close 1-cell gaps so the web is fully
// CONNECTED (pets must route between any two spawns) with room for a body.
for (let pass = 0; pass < 1; pass++) {
    const prev = walk.map((row) => row.slice());
    for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) { if (prev[r][c]) continue; if (prev[r - 1]?.[c] || prev[r + 1]?.[c] || prev[r][c - 1] || prev[r][c + 1]) walk[r][c] = true; }
}
// Safety: guarantee the exact scroll-spawn tile (the painted paw) is walkable even
// if the gold glyph there reads as non-path — the gold web already traces the plaza
// and its spokes, this is just insurance so the objective is always reachable.
if (full) {
    const cx = 0, cy = -1.1;       // scroll spawn = painted center paw (see find-seals.mjs)
    const c0 = Math.floor((cx + ARENA_X) / (2 * ARENA_X) * GCOLS), r0 = Math.floor((cy + ARENA_Y) / (2 * ARENA_Y) * GROWS);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const cc = c0 + dc, rr = r0 + dr; if (cc >= 0 && rr >= 0 && cc < GCOLS && rr < GROWS) walk[rr][cc] = true; }
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
const overlayBase = OVERLAY_SRC ? path.join(CLIENT, 'src', 'assets', 'coliseum', OVERLAY_SRC) : SRC;
await sharp(overlayBase).resize(MAP_W, MAP_H, { fit: 'fill' }).composite([{ input: overlay, raw: { width: MAP_W, height: MAP_H, channels: 4 } }]).png().toFile(DEBUG);
console.log(`${PREFIX} mask ${GCOLS}×${GROWS}: ${walkN}/${GCOLS * GROWS} walkable (${(walkN / (GCOLS * GROWS) * 100).toFixed(0)}%), largest component ${best} (${(best / walkN * 100).toFixed(0)}%) → ${path.relative(CLIENT, OUT)}; overlay → ${path.relative(CLIENT, DEBUG)}`);
