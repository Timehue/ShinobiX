// Background / scene-art generator for ShinobiX, tuned to the World Map.png look:
// vibrant painterly anime-fantasy concept art, rich saturated colour, dramatic
// cinematic light. Uses fal Flux (best fidelity for this style); falls back to
// OpenAI gpt-image-1 with --provider openai.
//
//   node scripts/gen-bg.mjs --id ice --prompt "a frozen glacier shrine valley…" \
//        --out src/assets/sectors/ice.webp [--size landscape_4_3] [--width 1280] [--provider fal|openai]
//
// Without --out the webp lands in asset-gen-out/bg/<id>.webp for review only.
// FAL_KEY / OPENAI_API_KEY are read from env or shinobij.client/.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes('--' + n);

function envKey(name) {
    if (process.env[name]) return process.env[name].trim();
    const p = path.join(CLIENT, '.env');
    if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = l.match(new RegExp('^' + name + '\\s*=\\s*(.+)$'));
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    return '';
}

// The single source of truth for "the game's look." Every background shares it
// so the world feels like one painted world. Keep in sync with the World Map.png.
export const STYLE = [
    'highly detailed painterly anime fantasy concept art',
    'vibrant saturated colours, luminous god-ray lighting, volumetric atmosphere',
    'epic RPG environment, lush and alive, intricate ornate detail, depth and scale',
    'wide cinematic establishing shot, no text, no words, no people, no UI, no frame, no border',
].join(', ');

const id = arg('id', 'bg');
const out = arg('out');
const size = arg('size', 'landscape_4_3');
const width = parseInt(arg('width', '1280'), 10);
const provider = arg('provider', 'fal');
const userPrompt = arg('prompt');
if (!userPrompt) { console.error('need --prompt'); process.exit(1); }
const prompt = `${userPrompt}. ${STYLE}`;

const reviewDir = path.join(CLIENT, 'asset-gen-out', 'bg');
fs.mkdirSync(reviewDir, { recursive: true });
const reviewPath = path.join(reviewDir, `${id}.webp`);
const targets = out ? [path.resolve(CLIENT, out), reviewPath] : [reviewPath];

async function fluxBytes() {
    const key = envKey('FAL_KEY');
    if (!key) { console.error('no FAL_KEY'); process.exit(1); }
    const model = arg('model', 'fal-ai/flux/dev');
    console.log(`[flux] ${model} · ${size} · generating "${id}"…`);
    const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: size, num_images: 1, num_inference_steps: 32, guidance_scale: 3.5, enable_safety_checker: false }),
    });
    if (!res.ok) { console.error(`fal error ${res.status}:`, (await res.text()).slice(0, 500)); process.exit(1); }
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) { console.error('no image:', JSON.stringify(json).slice(0, 400)); process.exit(1); }
    return Buffer.from(await (await fetch(url)).arrayBuffer());
}

async function openaiBytes() {
    const key = envKey('OPENAI_API_KEY');
    if (!key) { console.error('no OPENAI_API_KEY'); process.exit(1); }
    console.log(`[openai] gpt-image-1 · generating "${id}"…`);
    const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1536x1024', quality: 'high', n: 1 }),
    });
    const json = await res.json();
    if (!res.ok) { console.error(`openai error ${res.status}:`, json?.error?.message); process.exit(1); }
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) { console.error('no image data'); process.exit(1); }
    return Buffer.from(b64, 'base64');
}

const bytes = provider === 'openai' ? await openaiBytes() : await fluxBytes();
const sharp = (await import('sharp')).default;
for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    const pipe = sharp(bytes).resize(width, null, { withoutEnlargement: true });
    // Honour the target's extension so e.g. /Shinobi-Journeys.png stays a real PNG
    // (extension/content mismatch breaks decoding behind a static file server).
    await (t.toLowerCase().endsWith('.png') ? pipe.png({ quality: 90, compressionLevel: 9 }) : pipe.webp({ quality: 84 })).toFile(t);
    console.log(`  → ${path.relative(CLIENT, t)} (${(fs.statSync(t).size / 1024).toFixed(0)}KB)`);
}
if (flag('done')) console.log('done');
