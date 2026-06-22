// PILOT: extra MOVE-SEQUENCE frames per pet (fal.ai Nano-Banana edit).
//
// The shipped flipbook has ONE "attack" pose, so a strike can only snap to it.
// This generates a 4-frame ATTACK SEQUENCE (windup → lunge → impact → recover)
// of the SAME creature, so the renderer can play a real wind-up-and-hit instead
// of a single held pose. Same model/key/output shape as gen-pet-anim.mjs.
//
//   node scripts/gen-pet-moveframes.mjs --id <id> --src <referenceImage.webp>
//
// FAL_KEY from env or shinobij.client/.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const p = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^FAL_KEY\s*=\s*(.+)$/); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); }
    return '';
}

const MOVE_PROMPT = `Using the attached image as the EXACT reference creature, draw a horizontal sprite sheet of FOUR sequential animation frames of the SAME creature performing one MELEE ATTACK, on a FULLY TRANSPARENT background, side view, all facing RIGHT, evenly spaced left-to-right, identical art style, colors, line work, proportions and size in every frame, all standing on the same ground line:
1) WIND-UP: coiled, weight loaded onto the hind legs, body leaning AWAY from the strike (to the left), anticipation, tense.
2) LUNGE: launching forward, the front of the body and claws/limbs thrusting hard to the RIGHT, mouth open, fast dynamic anime motion.
3) IMPACT: full extension at the moment of contact — body stretched forward to the right, claws/limbs fully out, peak force, exaggerated.
4) RECOVER: settling back from the strike, weight forward, slightly off-balance, returning toward a neutral stance.
Each creature clearly separated with empty transparent space between them. No text, no labels, no numbers, no boxes, no grid lines, no shadows on a background — ONLY the four creatures on full transparency. Keep it perfectly on-model with the reference.`;

async function main() {
    const id = arg('id');
    if (!id) { console.error('need --id'); process.exit(1); }
    const src = arg('src', path.join(CLIENT_ROOT, 'asset-gen-out', 'petbody', `${id}.webp`));
    if (!fs.existsSync(src)) { console.error(`source not found: ${src}`); process.exit(1); }
    const outName = arg('out-name', id);
    const outDir = path.join(CLIENT_ROOT, 'asset-gen-out', 'pet-moveframes');
    fs.mkdirSync(outDir, { recursive: true });
    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found'); process.exit(1); }

    const bytes = fs.readFileSync(src);
    const dataUri = `data:image/${src.endsWith('.png') ? 'png' : 'webp'};base64,${bytes.toString('base64')}`;
    console.log(`pet ${id}  ref ${(bytes.length / 1024).toFixed(0)}KB → fal nano-banana/edit (4-frame attack sequence)…`);
    const res = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: MOVE_PROMPT, image_urls: [dataUri], num_images: 1, output_format: 'png', aspect_ratio: '16:9' }),
    });
    if (!res.ok) { console.error(`fal error ${res.status}:`, (await res.text()).slice(0, 600)); process.exit(1); }
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) { console.error('no image:', JSON.stringify(json).slice(0, 400)); process.exit(1); }
    const outBytes = url.startsWith('data:') ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : Buffer.from(await (await fetch(url)).arrayBuffer());
    const outFile = path.join(outDir, `${outName}-moves.png`);
    fs.writeFileSync(outFile, outBytes);
    console.log(`done ${(outBytes.length / 1024).toFixed(0)}KB → ${path.relative(CLIENT_ROOT, outFile)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
