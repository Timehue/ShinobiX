// High-quality battle-map generator via fal Flux (text-to-image) — far more
// detailed than gpt-image-1, for the rich top-down MOBA-map look.
//
//   node scripts/gen-map-flux.mjs --id battlemap-flux --prompt "..." [--model fal-ai/flux/dev] [--size landscape_4_3]
//
// FAL_KEY is read from env or shinobij.client/.env (same key the pose pipeline uses).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
function falKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY.trim();
    const p = path.join(CLIENT, '.env');
    if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^FAL_KEY\s*=\s*(.+)$/); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); }
    return '';
}

const model = arg('model', 'fal-ai/flux/dev');
const id = arg('id', 'battlemap-flux');
const size = arg('size', 'landscape_4_3');
const prompt = arg('prompt');
if (!prompt) { console.error('need --prompt'); process.exit(1); }
const key = falKey();
if (!key) { console.error('no FAL_KEY'); process.exit(1); }

const outDir = path.join(CLIENT, 'asset-gen-out', 'event');
fs.mkdirSync(outDir, { recursive: true });

console.log(`model ${model} · size ${size} · generating…`);
const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: size, num_images: 1, num_inference_steps: 32, guidance_scale: 3.5, enable_safety_checker: false }),
});
if (!res.ok) { console.error(`fal error ${res.status}:`, (await res.text()).slice(0, 500)); process.exit(1); }
const json = await res.json();
const url = json?.images?.[0]?.url;
if (!url) { console.error('no image:', JSON.stringify(json).slice(0, 400)); process.exit(1); }
const img = await fetch(url);
const bytes = Buffer.from(await img.arrayBuffer());

const sharp = (await import('sharp')).default;
const out = path.join(outDir, `${id}.webp`);
await sharp(bytes).resize(1408, null, { withoutEnlargement: true }).webp({ quality: 84 }).toFile(out);
console.log(`done: ${(fs.statSync(out).size / 1024).toFixed(0)}KB (${json.images[0].width}x${json.images[0].height}) → ${path.relative(CLIENT, out)}`);
