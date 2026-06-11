// Facing-normalize pass for generated petbody battle sprites.
//
// gpt-image-1 edits preserve the SOURCE portrait's orientation, so a batch of
// generated sprites comes out facing whichever way the original art faced.
// The battle renderers assume RIGHT-facing art (player as-is, enemy mirrored),
// so this pass: vision-classifies each local sprite's facing (cheap, ~$0.001),
// horizontally flips the LEFT-facing ones with sharp, overwrites the local
// file, and republishes the flipped petbody:<id>. Front-facing / ambiguous
// sprites are left untouched. Idempotent-ish: rerunning re-classifies, and a
// previously-flipped right-facing sprite just classifies right and is skipped.
//
//   node scripts/normalize-petbody-facing.mjs [--dry-run] [--only id1,id2]
//       [--server https://shinobijourney.com] [--model gpt-4o-mini] [--no-publish]
//
// Keys: OPENAI_API_KEY + ADMIN_PASSWORD from env or shinobij.client/.env.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(CLIENT_ROOT, 'asset-gen-out', 'petbody');

function parseArgs(argv) {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            if (['dry-run', 'no-publish'].includes(key)) flags[key] = true;
            else flags[key] = argv[++i];
        } else flags._.push(a);
    }
    return flags;
}

// --flip id1,id2 — UNCONDITIONAL mirror+republish for specific pets (no vision
// call). The manual override for sprites the classifier judged wrong.
function envFromDotenv(name) {
    if (process.env[name]) return process.env[name].trim();
    const p = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(p)) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            const m = line.match(new RegExp(`^${name}\\s*=\\s*(.+)$`));
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

const flags = parseArgs(process.argv.slice(2));
const SERVER = (flags.server || 'https://shinobijourney.com').replace(/\/$/, '');
const MODEL = flags.model || 'gpt-4o-mini';
const OPENAI_KEY = envFromDotenv('OPENAI_API_KEY');
const ADMIN_PW = envFromDotenv('ADMIN_PASSWORD');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function classifyFacing(webpBytes) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 5,
            messages: [{
                role: 'user',
                content: [
                    // STRICT rubric: the first lenient pass called many angled-left
                    // poses "front" and left them unflipped (they then face away
                    // from the opponent in battle). Bias toward a side answer —
                    // "front" is reserved for true dead-on symmetry.
                    { type: 'text', text: 'Look at this game creature sprite. Which side of the image is its head/snout/beak/eyes oriented toward, even slightly? If the head or gaze points at all toward the left side of the image, answer "left". If at all toward the right side, answer "right". Only answer "front" if it is perfectly symmetrical and dead-on facing the camera. Answer with exactly one word: left, right, or front.' },
                    { type: 'image_url', image_url: { url: `data:image/webp;base64,${webpBytes.toString('base64')}`, detail: 'low' } },
                ],
            }],
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI ${res.status}`);
    const answer = String(data?.choices?.[0]?.message?.content ?? '').toLowerCase();
    if (answer.includes('left')) return 'left';
    if (answer.includes('right')) return 'right';
    return 'front';
}

async function publish(id, dataUrl) {
    const res = await fetch(`${SERVER}/api/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': ADMIN_PW },
        body: JSON.stringify({ id, image: dataUrl }),
    });
    if (!res.ok) throw new Error(`publish ${id} failed: ${res.status}`);
}

async function main() {
    if (!flags['no-publish'] && !ADMIN_PW) { console.error('ADMIN_PASSWORD missing (or use --no-publish)'); process.exit(1); }
    const sharp = (await import('sharp')).default;

    // Manual override: flip these ids unconditionally, no vision call.
    if (flags.flip) {
        const ids = String(flags.flip).split(',').map((s) => s.trim()).filter(Boolean);
        for (const id of ids) {
            const file = path.join(OUT_DIR, `${id}.webp`);
            if (!fs.existsSync(file)) { console.error(`${id}: no local sprite at ${file}`); continue; }
            const out = await sharp(fs.readFileSync(file)).flop().webp({ quality: 80, effort: 6 }).toBuffer();
            fs.writeFileSync(file, out);
            if (!flags['no-publish']) await publish(`petbody:${id}`, `data:image/webp;base64,${out.toString('base64')}`);
            console.log(`${id}: force-flipped${flags['no-publish'] ? '' : ' + republished'}`);
        }
        return;
    }

    if (!OPENAI_KEY) { console.error('OPENAI_API_KEY missing'); process.exit(1); }

    const only = flags.only ? new Set(String(flags.only).split(',').map((s) => s.trim()).filter(Boolean)) : null;
    const files = fs.readdirSync(OUT_DIR)
        .filter((f) => f.endsWith('.webp'))
        .map((f) => f.replace(/\.webp$/, ''))
        .filter((id) => (only ? only.has(id) : true))
        .sort();
    console.log(`sprites to check: ${files.length} (model ${MODEL})`);

    const flipped = [], kept = [], failed = [];
    for (const id of files) {
        const file = path.join(OUT_DIR, `${id}.webp`);
        const bytes = fs.readFileSync(file);
        let facing;
        try {
            facing = await classifyFacing(bytes);
        } catch (e) {
            failed.push({ id, error: String(e.message ?? e) });
            console.error(`${id}: classify FAILED — ${e.message ?? e}`);
            await sleep(2000);
            continue;
        }
        if (facing !== 'left') {
            kept.push(id);
            console.log(`${id}: ${facing} — ok`);
        } else if (flags['dry-run']) {
            flipped.push(id);
            console.log(`${id}: LEFT — would flip`);
        } else {
            const out = await sharp(bytes).flop().webp({ quality: 80, effort: 6 }).toBuffer();
            fs.writeFileSync(file, out);
            if (!flags['no-publish']) await publish(`petbody:${id}`, `data:image/webp;base64,${out.toString('base64')}`);
            flipped.push(id);
            console.log(`${id}: LEFT — flipped${flags['no-publish'] ? '' : ' + republished'}`);
        }
        await sleep(150);
    }
    console.log(`\nDONE: ${flipped.length} flipped, ${kept.length} already right/front, ${failed.length} failed.`);
    if (failed.length) console.log(`retry failed: --only ${failed.map((f) => f.id).join(',')}`);
}

main().catch((err) => { console.error(err?.stack || String(err)); process.exitCode = 1; });
