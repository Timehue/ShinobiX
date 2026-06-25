// pose-regen.mjs — regenerate the pose frames that still have a baked dark/scene
// background (the low-contrast creatures AI matting couldn't separate). For each
// (pet, pose) it feeds the pet's OWN clean idle frame to fal Nano-Banana as the
// on-model reference and asks for that single pose on a transparent background, so
// the regenerated frame matches the rest of the pet's flipbook. Originals remain in
// asset-gen-out/pose-backup (run pose-cleanup.mjs --restore, or restore-frames.json).
//
//   FAL_KEY=... node scripts/pose-regen.mjs --plan asset-gen-out/restore-frames.json [--ref-cat idle] [--apply]
//   FAL_KEY=... node scripts/pose-regen.mjs --frames legendary-22:attack --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
sharp.cache(false);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const POSE_DIR = path.join(CLIENT, 'public', 'pet-poses');
const OUT_DIR = path.join(CLIENT, 'asset-gen-out', 'regen-test');
const PAD_FRAC = 0.10;

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (i >= 0 ? true : d); };
const has = (n) => process.argv.includes('--' + n);

function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    for (const p of [path.join(CLIENT, '.env'), 'C:/Users/Tyler R/source/repos/NinjaK/shinobij.client/.env']) {
        if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^FAL_KEY\s*=\s*(.+)$/); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); }
    }
    return '';
}

// Per-pose direction. Every prompt shares the same hard transparency + on-model rules.
const POSE_DESC = {
    attack: 'a dynamic ATTACK pose — lunging and striking forward to the RIGHT, limbs/claws extended hard, mouth open, fierce anime motion',
    hurt: 'a HURT recoil — snapped back from a hit, head jerked back, body flinching off-balance, still oriented to the RIGHT',
    cast: 'a CAST pose — rearing/bracing while channelling elemental energy, a glowing aura gathering around it, facing RIGHT',
    windup: 'a WIND-UP pose — coiled and tense, drawing back to charge an attack, facing RIGHT',
    lunge: 'a LUNGE — leaping forward to the RIGHT at full extension, airborne and dynamic',
    impact: 'an IMPACT pose — the instant a powerful strike lands, body driving hard forward to the RIGHT',
    recover: 'a RECOVER pose — settling back toward a ready stance after attacking, facing RIGHT',
    'run-a': 'a RUN pose (contact frame) — sprinting forward to the RIGHT, legs mid-stride planting',
    'run-b': 'a RUN pose (passing frame) — sprinting forward to the RIGHT, legs in the opposite mid-stride to a contact frame',
    idle: 'an IDLE ready combat stance, alert and coiled, facing RIGHT',
};
const STYLE = ' Keep the EXACT same creature, art style, colours, line work and proportions as the reference: smooth clean cel-shaded anime illustration with crisp ink outlines — NOT pixel art, NOT dithered, NOT blocky. No speed lines, no text, no extra creatures, only the single creature, perfectly on-model.';
const RULES = STYLE + ' FULLY TRANSPARENT background — absolutely NO background box, NO black or coloured rectangle, NO scene, NO ground shadow. ONLY the single creature on full transparency.';
// Chroma-key variant: a SOLID magenta field is a concrete instruction the model honours
// (unlike "transparent", which it fakes with a baked box/checkerboard), and magenta keys
// out cleanly regardless of whether the creature is dark, white or grey.
const RULES_CHROMA = STYLE + ' Place the creature on a SOLID, UNIFORM, FLAT, BRIGHT MAGENTA (#FF00FF pure magenta / chroma-key green-screen style but magenta) background that completely fills the entire frame behind and around the creature, edge to edge. The creature itself must contain NO magenta or hot-pink colours. NO other background, NO scene, NO box, NO ground shadow — just the single creature on a flat magenta field.';
let CHROMA = false;

async function regenFrame(key, id, cat, refCat) {
    const ref = path.join(POSE_DIR, `${id}-${refCat}.webp`);
    if (!fs.existsSync(ref)) throw new Error(`no reference ${id}-${refCat}`);
    const dataUri = `data:image/webp;base64,${fs.readFileSync(ref).toString('base64')}`;
    const prompt = `Using the attached image as the EXACT reference creature, redraw the SAME creature in ${POSE_DESC[cat] || POSE_DESC.idle}.${CHROMA ? RULES_CHROMA : RULES}`;
    const res = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_urls: [dataUri], num_images: 1, output_format: 'png' }),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) throw new Error('no image: ' + JSON.stringify(json).slice(0, 200));
    return url.startsWith('data:') ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : Buffer.from(await (await fetch(url)).arrayBuffer());
}

// Strip any residual non-transparent border (some gens add a faint white/grey field),
// trim to content, pad to a clean square. Keeps the creature exactly.
async function clean(pngBuf) {
    const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    if (CHROMA) {
        // Magenta chroma-key: bg = pixels where green sits far below red AND blue
        // (pure/anti-aliased magenta). Feather the edge + despill the purple fringe.
        for (let p = 0; p < W * H; p++) {
            const i = p * 4, R = data[i], G = data[i + 1], B = data[i + 2];
            const key = Math.min(R, B) - G;           // large for magenta, ≤0 for normal colour
            if (key >= 40) { data[i + 3] = 0; continue; }
            if (key >= 14) data[i + 3] = Math.round(data[i + 3] * (40 - key) / 26);
            const tint = Math.max(0, Math.min(R, B) - G);
            if (tint > 4) { data[i] = R - Math.round(tint * 0.6); data[i + 2] = B - Math.round(tint * 0.6); } // de-spill
        }
        // The real bg was magenta, so any BLACK is a letterbox bar / artifact the model added.
        // Edge-flood the (now-transparent) magenta region and clear border-connected near-black
        // — removes bars while interior creature outlines (not border-reachable) are protected.
        const seen = new Uint8Array(W * H), st = [];
        const clearable = (i) => { if (data[i + 3] < 60) return true; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 38; };
        const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = y * W + x; if (seen[p]) return; seen[p] = 1; if (clearable(p * 4)) { data[p * 4 + 3] = 0; st.push(p); } };
        for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); } for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
        while (st.length) { const p = st.pop(); const x = p % W, y = (p / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    } else {
        // edge-flood clear of near-white/near-transparent border (regen bg is light if any)
        const seen = new Uint8Array(W * H), st = [];
        const clearable = (i) => { const a = data[i + 3]; if (a < 90) return true; const r = data[i], g = data[i + 1], b = data[i + 2]; const mn = Math.min(r, g, b), mx = Math.max(r, g, b); const sat = mx ? (mx - mn) / mx : 0; return mn >= 235 && sat <= 0.06; };
        const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = y * W + x; if (seen[p]) return; seen[p] = 1; if (clearable(p * 4)) { data[p * 4 + 3] = 0; st.push(p); } };
        for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); } for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
        while (st.length) { const p = st.pop(); const x = p % W, y = (p / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    }
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (maxX < 0) return null;
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const cropped = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: minX, top: minY, width: cw, height: ch }).png().toBuffer();
    const side = Math.round(Math.max(cw, ch) * (1 + 2 * PAD_FRAC));
    return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: cropped, gravity: 'center' }]).webp({ quality: 90 }).toBuffer();
}

// Fraction of near-black OPAQUE pixels — a regen that came back on a solid black
// field (Nano-Banana sometimes ignores "transparent" for dark creatures) reads high
// here, so we re-roll it (a black field can't be keyed without eating a dark creature).
async function darkFrac(webpBuf) {
    const { data, info } = await sharp(webpBuf).ensureAlpha().resize(128, 128, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    let dark = 0; const N = info.width * info.height;
    for (let p = 0; p < N; p++) { if (data[p * 4 + 3] < 150) continue; const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2]; if (0.299 * r + 0.587 * g + 0.114 * b < 45) dark++; }
    return dark / N;
}

// Fraction of the BORDER RING that is opaque — a clean trimmed cutout has a transparent
// border, so a high value means the model baked a FIELD (black box, fake checkerboard,
// coloured oval reaching the edge) that the key didn't remove → re-roll.
async function edgeOpaqueFrac(webpBuf) {
    const { data, info } = await sharp(webpBuf).ensureAlpha().resize(120, 120, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, ring = 3; let op = 0, tot = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!(x < ring || y < ring || x >= W - ring || y >= H - ring)) continue; tot++; if (data[(y * W + x) * 4 + 3] > 150) op++; }
    return op / tot;
}

function framesFromArgs() {
    const out = [];
    const fr = arg('frames');
    if (typeof fr === 'string') for (const t of fr.split(',')) { const [id, cat] = t.split(':'); if (id && cat) out.push([id.trim(), cat.trim()]); }
    const plan = arg('plan');
    if (typeof plan === 'string') { const j = JSON.parse(fs.readFileSync(path.isAbsolute(plan) ? plan : path.join(CLIENT, plan), 'utf8')); for (const id in j) for (const cat of j[id]) out.push([id, cat]); }
    return out;
}

async function main() {
    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found'); process.exit(1); }
    const apply = has('apply');
    CHROMA = has('chroma');
    const refCat = (typeof arg('ref-cat') === 'string') ? arg('ref-cat') : 'idle';
    const frames = framesFromArgs();
    if (!frames.length) { console.error('need --frames id:cat,... or --plan file.json'); process.exit(1); }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`pose-regen: ${frames.length} frames via nano-banana (ref=${refCat}, ${apply ? 'APPLY→public' : 'DRY→' + path.relative(CLIENT, OUT_DIR)})`);
    let ok = 0, fail = 0;
    for (const [id, cat] of frames) {
        if (cat === refCat) { console.log(`  skip ${id}-${cat} (is the reference)`); continue; }
        try {
            let final = null, tries = 0, why = '';
            while (tries < 4) {
                tries++;
                const raw = await regenFrame(key, id, cat, refCat);
                const cand = await clean(raw);
                if (!cand) { why = 'EMPTY'; continue; }
                if (await darkFrac(cand) > 0.32) { why = 'BLACK-BG'; await new Promise((r) => setTimeout(r, 400)); continue; }       // came back on black
                if (await edgeOpaqueFrac(cand) > 0.30) { why = 'BAKED-FIELD'; await new Promise((r) => setTimeout(r, 400)); continue; } // baked checkerboard/box/oval field
                final = cand; break;
            }
            if (!final) { console.log(`  ${why} ${id}-${cat} (gave up after ${tries})`); fail++; continue; }
            const dst = apply ? path.join(POSE_DIR, `${id}-${cat}.webp`) : path.join(OUT_DIR, `${id}-${cat}.webp`);
            fs.writeFileSync(dst, final);
            ok++; console.log(`  ok ${id}-${cat}${tries > 1 ? ` (try ${tries})` : ''} → ${(final.length / 1024).toFixed(0)}KB`);
        } catch (e) { fail++; console.log(`  FAIL ${id}-${cat}: ${String(e.message || e).slice(0, 160)}`); }
        await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`done: ${ok} ok, ${fail} failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
