// Pet RUN-cycle generator (fal.ai Nano-Banana edit) — the missing piece that
// kills the "gliding" look. The 4-pose combat sheet (idle/attack/hurt/cast) has
// no locomotion frame, so a moving pet just slides its idle sprite. This adds a
// 2-frame run cycle (run-a contact / run-b airborne) the renderer alternates
// while a pet traverses the map, so it READS as running.
//
//   node scripts/gen-pet-run.mjs --id legendary-0
//
// One fal generation (~$0.10) → asset-gen-out/pet-anim/<id>-run-poses.png.
// Slice with: node scripts/slice-pet-poses.mjs --in <that> --out-name <id> --poses run-a,run-b --out-dir asset-gen-out/pet-poses-all
// FAL_KEY is read from env or shinobij.client/.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
function resolveFalKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const p = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(p)) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^FAL_KEY\s*=\s*(.+)$/); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); }
    return '';
}

const RUN_PROMPT = `Using the attached image as the EXACT reference creature, draw a horizontal sprite sheet of TWO running poses of the SAME creature on a FULLY TRANSPARENT background, side view, both facing RIGHT, evenly spaced left-to-right, identical art style, colors, line work, proportions and size, both clearly mid-run with a strong sense of forward momentum:
1) CONTACT stride: front leg(s) reaching forward and planted, rear leg(s) extended back pushing off, body leaning forward into the run.
2) AIRBORNE stride: legs gathered under the body in a mid-bound, both/all feet off the ground, body still leaning forward, hair / tail / cloth / mane streaming back from the speed.
Clearly separated with empty transparent space between them. No text, no labels, no numbers, no boxes, no grid lines, no ground shadow — ONLY the two creatures on full transparency. Keep perfectly on-model with the reference (same species, same colors, same details).`;

async function main() {
    const id = arg('id');
    if (!id) { console.error('need --id <petId>'); process.exit(1); }
    const src = arg('src', path.join(CLIENT_ROOT, 'asset-gen-out', 'petbody', `${id}.webp`));
    if (!fs.existsSync(src)) { console.error(`source sprite not found: ${src}`); process.exit(1); }
    const outName = arg('out-name', id);
    const outDir = path.join(CLIENT_ROOT, 'asset-gen-out', 'pet-anim');
    fs.mkdirSync(outDir, { recursive: true });

    const key = resolveFalKey();
    if (!key) { console.error('FAL_KEY not found in env or .env'); process.exit(1); }

    const bytes = fs.readFileSync(src);
    const dataUri = `data:image/webp;base64,${bytes.toString('base64')}`;
    console.log(`pet:    ${id}  (${(bytes.length / 1024).toFixed(0)} KB ref) → 2-frame run cycle`);

    const res = await fetch('https://fal.run/fal-ai/nano-banana/edit', {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: RUN_PROMPT, image_urls: [dataUri], num_images: 1, output_format: 'png', aspect_ratio: '16:9' }),
    });
    if (!res.ok) { console.error(`fal error ${res.status}:`, (await res.text()).slice(0, 600)); process.exit(1); }
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) { console.error('no image in response:', JSON.stringify(json).slice(0, 600)); process.exit(1); }

    const outBytes = url.startsWith('data:')
        ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
        : Buffer.from(await (await fetch(url)).arrayBuffer());
    const outFile = path.join(outDir, `${outName}-run-poses.png`);
    fs.writeFileSync(outFile, outBytes);
    console.log(`done:   ${(outBytes.length / 1024).toFixed(0)} KB → ${path.relative(CLIENT_ROOT, outFile)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
