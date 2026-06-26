// Arena Warden animation-frame generator (fal.ai Nano-Banana edit, img2img).
//
//   boss-warden.webp ──▶ fal-ai/nano-banana/edit (ONE call per pose) ──▶
//                         a single posed golem ──▶ de-bg + trim + square ──▶
//                         src/assets/coliseum/warden-<pose>.webp
//
// We generate ONE figure per call (not a 4-up sheet): the sheet approach kept the
// frames on-model but Nano-Banana rendered them on an opaque bg and unevenly spaced,
// so the column-slicer mis-cut them. One figure per call sidesteps segmentation
// entirely, and passing the base sprite as the reference each time keeps every pose
// on-model. Poses match the Warden's moves: idle / walk / wind-up / slam.
//
//   node scripts/gen-warden-frames.mjs            # all four
//   node scripts/gen-warden-frames.mjs --only slam
//
// FAL_KEY from env or shinobij.client/.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const p = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^FAL_KEY\s*=\s*(.+)$/); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); }
    return '';
}

const POSES = {
    idle: 'a menacing ready battle stance, both fists low at its sides, weight settled, head up',
    walk: 'a heavy lumbering walk mid-stride, one great stone leg stepping forward, the other back, body leaning into the step, fists swinging low',
    windup: 'rearing back to slam: both massive fists raised high overhead together, body arched backward, chest up, teal rune-light flaring bright, full anticipation',
    slam: 'mid ground-slam: both massive fists smashing straight DOWN onto the ground at full extension, body hunched low forward over the impact, knees bent, peak force, exaggerated',
};

// --- MAGENTA chroma-key (the proven path for desaturated subjects: a black/white flood
//     EATS a grey/green golem, and "transparent background" prompts come back opaque — so
//     we render on flat magenta and key it out). magenta-ness = min(R,B) − G: huge on the
//     ~(255,0,255) bg, ≤0 on the golem's grey stone / green moss / teal runes. ---
function keyMagenta(data) {
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const m = Math.min(r, b) - g;            // how magenta this pixel is
        if (m > 90) { data[i + 3] = 0; continue; }                       // solid bg → transparent
        if (m > 45) { data[i + 3] = Math.round(data[i + 3] * ((90 - m) / 45)); } // anti-aliased edge → feather
        if (m > 0) { const k = Math.min(1, m / 90); data[i] = Math.round(r - (r - g) * 0.6 * k); data[i + 2] = Math.round(b - (b - g) * 0.6 * k); }  // de-spill the purple fringe
    }
}

async function genPose(pose, desc, key, refUri) {
    const prompt = `Using the attached image as the EXACT reference creature (a colossal stone-and-moss temple golem boss with glowing teal rune-light and two horns), redraw the SAME golem as a SINGLE full-body figure in this pose: ${desc}. Front three-quarter view, facing slightly to the right, centered, full body head-to-feet, on a SOLID FLAT PURE MAGENTA background (hex #FF00FF, chroma-key green-screen style, completely uniform, no gradient), identical art style, colors, rune-light, proportions and size to the reference. The golem itself must contain NO magenta or pink. No text, no labels, no extra characters, no ground line, no shadow. Keep it perfectly on-model with the reference.`;
    const res = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_urls: [refUri], num_images: 1, output_format: 'png', aspect_ratio: '1:1' }),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) throw new Error('no image: ' + JSON.stringify(json).slice(0, 300));
    const raw = url.startsWith('data:') ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : Buffer.from(await (await fetch(url)).arrayBuffer());

    const img = sharp(raw).ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    keyMagenta(data);
    const outDir = path.join(CLIENT_ROOT, 'src', 'assets', 'coliseum');
    const out = path.join(outDir, `warden-${pose}.webp`);
    const webp = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .trim({ threshold: 10 })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 86 })
        .toBuffer();
    fs.writeFileSync(out, webp);
    console.log(`  ${pose}: ${(webp.length / 1024).toFixed(0)} KB → ${path.relative(CLIENT_ROOT, out)}`);
}

async function main() {
    const only = arg('only');
    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found'); process.exit(1); }
    const src = path.join(CLIENT_ROOT, 'src', 'assets', 'coliseum', 'boss-warden.webp');
    if (!fs.existsSync(src)) { console.error(`reference not found: ${src}`); process.exit(1); }
    const refUri = `data:image/webp;base64,${fs.readFileSync(src).toString('base64')}`;
    const list = only ? [only] : Object.keys(POSES);
    console.log(`model: fal-ai/nano-banana/edit → ${list.length} single-figure pose(s): ${list.join(', ')}`);
    for (const pose of list) {
        if (!POSES[pose]) { console.error(`unknown pose ${pose}`); continue; }
        console.log(`generating ${pose}…`);
        await genPose(pose, POSES[pose], key, refUri);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
