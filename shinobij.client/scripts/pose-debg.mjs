// pose-debg.mjs — AI background removal for the baked-black-box pet pose frames.
// Flood-fill can't tell a desaturated creature from a black/grey background; a
// trained matting model (fal BiRefNet) segments the creature correctly. Reads the
// ORIGINAL frame from the backup, mattes out the background, re-trims + pads to a
// clean square, and (with --apply) writes it back to public/pet-poses.
//
//   FAL_KEY=... node scripts/pose-debg.mjs --frames standard-25:attack,rare-20:attack [--apply]
//   FAL_KEY=... node scripts/pose-debg.mjs --plan asset-gen-out/blackbox-frames.json --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
sharp.cache(false);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const POSE_DIR = path.join(CLIENT, 'public', 'pet-poses');
const BACKUP_DIR = path.join(CLIENT, 'asset-gen-out', 'pose-backup');
const OUT_DIR = path.join(CLIENT, 'asset-gen-out', 'debg-test');
const PAD_FRAC = 0.10;

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (i >= 0 ? true : d); };
const has = (n) => process.argv.includes('--' + n);

function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    for (const p of [path.join(CLIENT, '.env'), path.resolve(CLIENT, '..', '..', '..', '..', '..', 'shinobij.client', '.env')]) {
        if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^FAL_KEY\s*=\s*(.+)$/); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); }
    }
    return '';
}

async function matte(key, srcFile, model) {
    const bytes = fs.readFileSync(srcFile);
    const dataUri = `data:image/webp;base64,${bytes.toString('base64')}`;
    const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: dataUri, output_format: 'png' }),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const url = json?.image?.url || json?.images?.[0]?.url;
    if (!url) throw new Error('no image in response: ' + JSON.stringify(json).slice(0, 300));
    if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    return Buffer.from(await (await fetch(url)).arrayBuffer());
}

/** Trim the matte to its content + pad to a clean square (PAD_FRAC margin). */
async function trimPad(pngBuf) {
    const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (maxX < 0) return null;
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const cropped = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: minX, top: minY, width: cw, height: ch }).png().toBuffer();
    const side = Math.round(Math.max(cw, ch) * (1 + 2 * PAD_FRAC));
    return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: cropped, gravity: 'center' }]).webp({ quality: 90 }).toBuffer();
}

function framesFromArgs() {
    const out = [];
    const fr = arg('frames');
    if (typeof fr === 'string') for (const tok of fr.split(',')) { const [id, cat] = tok.split(':'); if (id && cat) out.push([id.trim(), cat.trim()]); }
    const plan = arg('plan');
    if (typeof plan === 'string') { const j = JSON.parse(fs.readFileSync(path.isAbsolute(plan) ? plan : path.join(CLIENT, plan), 'utf8')); for (const id in j) for (const cat of j[id]) out.push([id, cat]); }
    return out;
}

async function main() {
    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found (env or .env)'); process.exit(1); }
    const apply = has('apply');
    const model = (typeof arg('model') === 'string') ? arg('model') : 'fal-ai/birefnet';
    const frames = framesFromArgs();
    if (!frames.length) { console.error('need --frames id:cat,... or --plan file.json'); process.exit(1); }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`pose-debg: ${frames.length} frames via ${model}  (${apply ? 'APPLY→public' : 'DRY→' + path.relative(CLIENT, OUT_DIR)})`);
    let ok = 0, fail = 0;
    for (const [id, cat] of frames) {
        const src = path.join(BACKUP_DIR, `${id}-${cat}.webp`);
        if (!fs.existsSync(src)) { console.log(`  SKIP ${id}-${cat} (no backup)`); continue; }
        try {
            const matted = await matte(key, src, model);
            const final = await trimPad(matted);
            if (!final) { console.log(`  EMPTY ${id}-${cat} (matte removed everything)`); fail++; continue; }
            const dst = apply ? path.join(POSE_DIR, `${id}-${cat}.webp`) : path.join(OUT_DIR, `${id}-${cat}.webp`);
            fs.writeFileSync(dst, final);
            ok++; console.log(`  ok ${id}-${cat}  → ${(final.length / 1024).toFixed(0)}KB`);
        } catch (e) { fail++; console.log(`  FAIL ${id}-${cat}: ${String(e.message || e).slice(0, 160)}`); }
        await new Promise((r) => setTimeout(r, 350)); // courtesy delay
    }
    console.log(`done: ${ok} ok, ${fail} failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
