// Bake the painted restorations for ruined sector buildings.
//   node --import tsx scripts/bake-ruin-restorations.mjs [--preview <dir>]
// Inputs: the Figma renders in shinobij.client/art-source/ruin-restorations/
// (`<source>-provider-v1.webp`, flat magenta key, stored at WebP q95) and the layout in
// shared/sector-ruin-restorations.ts. Output: one transparent WebP per ruin in
// shinobij.client/public/sector-buildings/, drawn into the floor while that ruin
// stands restored. Re-run after changing a render or the layout, then update
// docs/art/sector-building-art-v1.json and the verify-dist receipt.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { RUIN_RESTORATIONS, RUIN_TILE_PX, restorationArtBounds } from '../shared/sector-ruin-restorations.ts';
import { sectorBuilding } from '../shared/sector-buildings.ts';
import { sectorWalkMask } from '../shared/sector-walk-mask.ts';

const SOURCE_DIR = 'shinobij.client/art-source/ruin-restorations';
const OUT_DIR = 'shinobij.client/public/sector-buildings';
const FEATHER = 14;
const previewIndex = process.argv.indexOf('--preview'), previewDir = previewIndex > 0 ? process.argv[previewIndex + 1] : undefined;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

const hasRender = async source => { try { await readFile(`${SOURCE_DIR}/${source}-provider-v1.webp`); return true; } catch { return false; } };
/** The weathered variant uses `<source>-weathered` where a render exists; small props
 * without one get a mild procedural aging (less saturated, a little darker). */
async function pieceRender(source, variant) {
    if (variant === 'weathered' && await hasRender(`${source}-weathered`)) return keyed(`${source}-weathered`);
    const render = await keyed(source);
    if (variant === 'weathered') for (let i = 0; i < render.data.length; i += 4) {
        const [r, g, b] = [render.data[i], render.data[i + 1], render.data[i + 2]], grey = r * .3 + g * .59 + b * .11;
        render.data[i] = Math.round((r * .7 + grey * .3) * .88); render.data[i + 1] = Math.round((g * .7 + grey * .3) * .88); render.data[i + 2] = Math.round((b * .7 + grey * .3) * .88);
    }
    return render;
}
/** Key a flat magenta background to alpha and pull magenta spill off the edges. */
async function keyed(source) {
    const { data, info } = await sharp(await readFile(`${SOURCE_DIR}/${source}-provider-v1.webp`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];
        const magenta = (Math.min(r, b) - g) / 255, balance = Math.abs(r - b) / 255;
        const alpha = balance > .35 ? 1 : 1 - clamp((magenta - .18) / .4);
        if (alpha < 1 && alpha > 0) { r = Math.min(r, g + 30); b = Math.min(b, g + 30); }
        out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = Math.round(alpha * 255);
    }
    // Trim the key margin so the painted subject, not the empty magenta, fills its tiles.
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (out[(y * info.width + x) * 4 + 3] > 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) throw Error(`${source}: nothing left after keying`);
    const width = x1 - x0 + 1, height = y1 - y0 + 1;
    const trimmed = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left: x0, top: y0, width, height }).raw().toBuffer();
    return { data: trimmed, width, height };
}
/** Fit a render into a tile block: stretch when the aspect is close, else centre-crop to it. */
async function fitted(render, width, height) {
    const target = width / height, aspect = render.width / render.height;
    let image = sharp(render.data, { raw: { width: render.width, height: render.height, channels: 4 } });
    if (Math.max(target / aspect, aspect / target) > 1.6) {
        const w = aspect > target ? Math.round(render.height * target) : render.width, h = aspect > target ? render.height : Math.round(render.width / target);
        image = sharp(await image.extract({ left: Math.floor((render.width - w) / 2), top: Math.floor((render.height - h) / 2), width: w, height: h }).raw().toBuffer(), { raw: { width: w, height: h, channels: 4 } });
    }
    return image.resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
}

async function bake(spec, variant = 'restored') {
    const building = sectorBuilding(spec.buildingId);
    if (!building || building.kind !== 'ruin') throw Error(`${spec.buildingId} is not a registered ruin`);
    const mask = sectorWalkMask(building.sector);
    const tileAt = (x, y) => mask[Math.min(11, Math.floor(y / RUIN_TILE_PX))][Math.min(11, Math.floor(x / RUIN_TILE_PX))];
    for (const { source, tile: [c, r, w, h] } of spec.pieces) for (let row = r; row < r + h; row++) for (let col = c; col < c + w; col++)
        if (!'#B'.includes(mask[row][col])) throw Error(`${spec.buildingId}: ${source} would cover walkable tile ${row * 12 + col}`);
    for (const [x0, y0, x1, y1] of spec.clear) for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x += 4)
        if ('=~'.includes(tileAt(x, y))) throw Error(`${spec.buildingId}: cleared ground would cover road or water at ${x},${y}`);

    const floor = await readFile(`shinobij.client/public/sector-map/s${spec.artKey}.webp`);
    const base = await sharp(floor).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (base.info.width !== 1024 || base.info.height !== 1024) throw Error('Expected a 1024px floor');
    const box = restorationArtBounds(spec), W = box.width, H = box.height;
    const px = (x, y) => (y * 1024 + x) * 4;
    const art = new Float32Array(W * H * 4);
    const over = (i, r, g, b, a) => { const keep = 1 - a; art[i] = r * a + art[i] * keep; art[i + 1] = g * a + art[i + 1] * keep; art[i + 2] = b * a + art[i + 2] * keep; art[i + 3] = a + art[i + 3] * keep; };

    // 1. Clear the plot with the floor's own ground, mirrored so the patch never shows a seam.
    const [gx0, gy0, gx1, gy1] = spec.ground, gw = gx1 - gx0, gh = gy1 - gy0;
    const mirror = (v, n) => { const m = v % (2 * n); return m < n ? m : 2 * n - 1 - m; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fx = box.x + x, fy = box.y + y;
        let a = 0;
        for (const [x0, y0, x1, y1] of spec.clear) if (fx >= x0 && fx < x1 && fy >= y0 && fy < y1) {
            const edge = Math.min(fx - x0 + (x0 === 0 ? FEATHER : 0), fy - y0 + (y0 === 0 ? FEATHER : 0), x1 - 1 - fx + (x1 === 1024 ? FEATHER : 0), y1 - 1 - fy + (y1 === 1024 ? FEATHER : 0));
            a = Math.max(a, clamp(edge / FEATHER));
        }
        if (!a) continue;
        const s = px(gx0 + mirror(fx, gw), gy0 + mirror(fy, gh));
        over((y * W + x) * 4, base.data[s], base.data[s + 1], base.data[s + 2], a);
    }
    // 2. Intact pieces with a soft shadow, colour pulled partly toward the original painting.
    const shadows = [], layers = [];
    for (const { source, tile: [c, r, w, h] } of spec.pieces) {
        const pw = Math.round(w * RUIN_TILE_PX), ph = Math.round(h * RUIN_TILE_PX), left = Math.round(c * RUIN_TILE_PX), top = Math.round(r * RUIN_TILE_PX);
        const rgba = await fitted(await pieceRender(source, variant), pw, ph);
        const weight = w * h >= 2 ? .6 : .3;
        for (let ch = 0; ch < 3; ch++) {
            let sm = 0, ss = 0, n = 0, rm = 0, rs = 0;
            for (let i = 0; i < pw * ph; i++) if (rgba[i * 4 + 3] > 200) { const v = rgba[i * 4 + ch]; sm += v; ss += v * v; n++; }
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const v = base.data[px(left + x, top + y) + ch]; rm += v; rs += v * v; }
            if (!n) continue;
            sm /= n; ss = Math.sqrt(Math.max(1, ss / n - sm * sm)); rm /= pw * ph; rs = Math.sqrt(Math.max(1, rs / (pw * ph) - rm * rm));
            const scale = (1 - weight * .8 + weight * .8 * rs / ss), mean = sm * (1 - weight) + rm * weight;
            for (let i = 0; i < pw * ph; i++) rgba[i * 4 + ch] = Math.round(clamp((rgba[i * 4 + ch] - sm) * scale + mean, 0, 255));
        }
        const sw = pw + 20, sh = ph + 20, alpha = Buffer.alloc(sw * sh);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) alpha[(y + 10) * sw + x + 10] = Math.round(rgba[(y * pw + x) * 4 + 3] * .45);
        const blurred = await sharp(alpha, { raw: { width: sw, height: sh, channels: 1 } }).blur(5).raw().toBuffer({ resolveWithObject: true });
        shadows.push({ data: blurred.data, channels: blurred.info.channels, w: sw, h: sh, left: left - 10 + 6, top: top - 10 + 8 });
        layers.push({ data: rgba, w: pw, h: ph, left, top });
    }
    for (const s of shadows) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        const ax = s.left + x - box.x, ay = s.top + y - box.y; if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const a = s.data[(y * s.w + x) * s.channels] / 255; if (a) over((ay * W + ax) * 4, 20, 12, 5, a);
    }
    for (const l of layers) for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
        const ax = l.left + x - box.x, ay = l.top + y - box.y; if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const i = (y * l.w + x) * 4, a = l.data[i + 3] / 255; if (a) over((ay * W + ax) * 4, l.data[i], l.data[i + 1], l.data[i + 2], a);
    }
    const out = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { const a = art[i * 4 + 3]; out[i * 4 + 3] = Math.round(a * 255); for (let c = 0; c < 3; c++) out[i * 4 + c] = a ? Math.round(clamp(art[i * 4 + c] / a, 0, 255)) : 0; }
    const webp = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
    const file = `${OUT_DIR}/${variant}-${spec.buildingId}-v1.webp`;
    await writeFile(file, webp);
    if (previewDir) {
        const after = await sharp(floor).composite([{ input: webp, left: box.x, top: box.y }]).png().toBuffer();
        const crop = { left: Math.max(0, box.x - 40), top: Math.max(0, box.y - 40), width: Math.min(1024 - Math.max(0, box.x - 40), W + 80), height: Math.min(1024 - Math.max(0, box.y - 40), H + 80) };
        await sharp(floor).extract(crop).png().toFile(`${previewDir}/${spec.buildingId}-before.png`);
        await sharp(after).extract(crop).png().toFile(`${previewDir}/${spec.buildingId}-${variant}.png`);
    }
    return { id: `${variant}-${spec.buildingId}`, variant, file, bytes: webp.length, sha256: hash(webp), width: W, height: H, bounds: box,
        sources: spec.pieces.map(p => p.source).filter((s, i, all) => all.indexOf(s) === i) };
}

await mkdir(OUT_DIR, { recursive: true }); if (previewDir) await mkdir(previewDir, { recursive: true });
const records = [];
for (const spec of RUIN_RESTORATIONS) for (const variant of ['restored', 'weathered']) records.push(await bake(spec, variant));
console.log(JSON.stringify(records.map(({ id, bytes, width, height }) => ({ id, bytes, width, height }))));
await writeFile(`${SOURCE_DIR}/bake-receipt.json`, JSON.stringify({ recipe: 'scripts/bake-ruin-restorations.mjs', layout: 'shared/sector-ruin-restorations.ts', records }, null, 2) + '\n');
