// Pet animation-POSE generator (fal.ai Nano-Banana edit).
//
//   pet battle sprite ──▶ fal-ai/nano-banana/edit ──▶ a sprite sheet of poses
//                          (idle / attack / hurt, same creature, transparent)
//
// We can't run a video pipeline here (no ffmpeg, can't eyeball MP4), so instead
// we ask an image-edit model to redraw the EXISTING pet sprite in a few distinct
// combat POSES in one image. The renderer swaps pose textures per beat and the
// procedural choreography (lunge / flinch / hit-stop) supplies the motion.
//
//   node scripts/gen-pet-anim.mjs --id mythic-0
//   node scripts/gen-pet-anim.mjs --id mythic-0 --src path.webp --out-name kitsune
//
// FAL_KEY is read from env or shinobij.client/.env (same place OPENAI_API_KEY lives).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const p = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(p)) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            const m = line.match(/^FAL_KEY\s*=\s*(.+)$/);
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

const POSE_PROMPT = `Using the attached image as the EXACT reference creature, draw a horizontal sprite sheet of FOUR poses of the SAME creature on a FULLY TRANSPARENT background, side view, all facing RIGHT, evenly spaced left-to-right, identical art style, colors, line work, proportions, and size in every frame, all standing on the same ground line:
1) IDLE: an alert ready combat stance, weight low, coiled.
2) ATTACK: a forward lunging strike — body and claws/limbs extended hard to the right, dynamic anime motion, mouth open.
3) HURT: recoiling backward from a hit — head snapped back, body flinching, off-balance.
4) CAST: rearing up gathering elemental energy, glowing aura around it.
Each creature clearly separated with empty transparent space between them. No text, no labels, no numbers, no boxes, no grid lines, no shadows on a background — ONLY the four creatures on full transparency. Keep it perfectly on-model with the reference.`;

async function main() {
    const id = arg('id');
    if (!id) { console.error('need --id <petId> (e.g. mythic-0)'); process.exit(1); }
    const src = arg('src', path.join(CLIENT_ROOT, 'asset-gen-out', 'petbody', `${id}.webp`));
    if (!fs.existsSync(src)) { console.error(`source sprite not found: ${src}`); process.exit(1); }
    const outName = arg('out-name', id);
    const outDir = path.join(CLIENT_ROOT, 'asset-gen-out', 'pet-anim');
    fs.mkdirSync(outDir, { recursive: true });

    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found in env or .env'); process.exit(1); }

    // Reference image as a data URI (fal accepts data URIs for image_urls).
    const bytes = fs.readFileSync(src);
    const dataUri = `data:image/webp;base64,${bytes.toString('base64')}`;
    console.log(`pet:    ${id}  (${(bytes.length / 1024).toFixed(0)} KB ref)`);
    console.log(`model:  fal-ai/nano-banana/edit  → 4-pose sheet (idle/attack/hurt/cast)`);
    console.log('generating…');

    const res = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: POSE_PROMPT,
            image_urls: [dataUri],
            num_images: 1,
            output_format: 'png',
            aspect_ratio: '16:9',
        }),
    });
    if (!res.ok) {
        console.error(`fal error ${res.status}:`, (await res.text()).slice(0, 600));
        process.exit(1);
    }
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) { console.error('no image in response:', JSON.stringify(json).slice(0, 600)); process.exit(1); }

    let outBytes;
    if (url.startsWith('data:')) {
        outBytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    } else {
        const img = await fetch(url);
        outBytes = Buffer.from(await img.arrayBuffer());
    }
    const outFile = path.join(outDir, `${outName}-poses.png`);
    fs.writeFileSync(outFile, outBytes);
    console.log(`done:   ${(outBytes.length / 1024).toFixed(0)} KB  → ${path.relative(CLIENT_ROOT, outFile)}`);
    if (json.description) console.log(`desc:   ${json.description.slice(0, 200)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
