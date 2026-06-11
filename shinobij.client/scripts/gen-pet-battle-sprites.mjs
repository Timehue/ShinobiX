// Pet BATTLE-SPRITE batch generator (the "Option C" pipeline).
//
//   prod `pet:<id>` portrait ──▶ OpenAI gpt-image-1 /images/edits
//        (image-to-image: same creature, action pose, facing RIGHT,
//         transparent background)
//   ──▶ sharp (resize + WebP, alpha kept) ──▶ asset-gen-out/petbody/<id>.webp
//   ──▶ POST /api/images  id=`petbody:<id>`  (admin)  ──▶ the battle renderers
//        pick it up automatically (petBattleSprite prefers petbody: over pet:).
//
// Run from shinobij.client/ (sharp + the OpenAI key live here):
//
//   node scripts/gen-pet-battle-sprites.mjs --probe                  # verify server prefix deploy
//   node scripts/gen-pet-battle-sprites.mjs --dry-run                # list work + cost estimate
//   node scripts/gen-pet-battle-sprites.mjs                          # full run (skips existing petbody)
//   node scripts/gen-pet-battle-sprites.mjs --only standard-1,rare-3 --force   # regen specific pets
//   node scripts/gen-pet-battle-sprites.mjs --limit 5                # first N only
//   node scripts/gen-pet-battle-sprites.mjs --no-publish             # generate locally only
//
// Flags: --server <url> (default https://shinobijourney.com), --gen-quality low|medium|high
// (default medium), --concurrency N (default 3), --quality <webp q> (default 80),
// --max-px <px> (default 640).
//
// Keys: OPENAI_API_KEY + ADMIN_PASSWORD from env or shinobij.client/.env.
// Idempotent/resumable: pets that already have a published petbody: (or a local
// output file) are skipped unless --force. Emits review.html (before/after grid)
// + failures.json for retries.

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
            if (['dry-run', 'force', 'no-publish', 'probe'].includes(key)) flags[key] = true;
            else flags[key] = argv[++i];
        } else flags._.push(a);
    }
    return flags;
}

function envFromDotenv(name) {
    if (process.env[name]) return process.env[name].trim();
    const dotenvPath = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(dotenvPath)) {
        for (const line of fs.readFileSync(dotenvPath, 'utf8').split('\n')) {
            const m = line.match(new RegExp(`^${name}\\s*=\\s*(.+)$`));
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

const flags = parseArgs(process.argv.slice(2));
const SERVER = (flags.server || 'https://shinobijourney.com').replace(/\/$/, '');
const GEN_QUALITY = flags['gen-quality'] || 'medium';
const WEBP_Q = Number(flags.quality) || 80;
const MAX_PX = Number(flags['max-px']) || 640;
const CONCURRENCY = Math.max(1, Number(flags.concurrency) || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPENAI_KEY = envFromDotenv('OPENAI_API_KEY');
const ADMIN_PW = envFromDotenv('ADMIN_PASSWORD');

// The likeness-preserving battle-pose prompt. "facing RIGHT" is the project
// convention: player side shows art as-is, enemy side mirrors. Avoids words
// that have tripped gpt-image-1's safety filter before ("fierce", "battle
// stance"); FALLBACK_PROMPT is the extra-soft retry for safety rejections.
const PROMPT =
    'Recreate the creature from this image as a full-body fantasy game sprite. ' +
    'Keep the SAME species, anatomy, colors, markings, accessories and distinctive features so it is clearly the same creature. ' +
    'Pose: energetic action stance, three-quarter view facing to the RIGHT, whole body visible including feet, centered. ' +
    'Clean anime fantasy creature art, crisp edges. ' +
    'Isolated subject on a fully transparent background — no scenery, no ground, no shadow, no frame, no border, no text.';
const FALLBACK_PROMPT =
    'Redraw the cute creature from this image as a full-body game character sprite: same species, colors and features, ' +
    'lively standing pose facing to the right, whole body visible, centered, anime fantasy art style. ' +
    'Fully transparent background, no scenery, no shadow, no frame, no text.';

function stripVariant(id) { return id.replace(/-\d{10,}$/, ''); }

async function fetchRegistry() {
    const r = await fetch(`${SERVER}/api/images?cat=pet&cb=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`registry fetch failed: ${r.status}`);
    return await r.json();
}

/** Resolve a registry value (data URL / reference URL / http URL) to bytes. */
async function valueToBytes(value, id) {
    if (typeof value !== 'string' || !value) return null;
    if (value.startsWith('data:image/')) {
        const comma = value.indexOf(',');
        return Buffer.from(value.slice(comma + 1), 'base64');
    }
    const url = value.startsWith('/') ? `${SERVER}${value}` : value.startsWith('http') ? value : `${SERVER}/api/img?id=${encodeURIComponent(id)}`;
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
}

async function openaiEdit(imageBytes, prompt) {
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    // The Blob MUST carry an image/* MIME type — a typeless Blob uploads as
    // application/octet-stream, which the API rejects. Caller pre-normalizes
    // the bytes to PNG via sharp, so the type is always accurate here.
    fd.append('image[]', new Blob([imageBytes], { type: 'image/png' }), 'portrait.png');
    fd.append('prompt', prompt);
    fd.append('size', '1024x1024');
    fd.append('quality', GEN_QUALITY);
    fd.append('background', 'transparent');
    fd.append('output_format', 'png');
    fd.append('n', '1');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error?.message ?? `OpenAI ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.safety = /safety system|rejected/i.test(msg);
        throw err;
    }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data');
    return Buffer.from(b64, 'base64');
}

async function publish(id, dataUrl) {
    const res = await fetch(`${SERVER}/api/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': ADMIN_PW },
        body: JSON.stringify({ id, image: dataUrl }),
    });
    if (!res.ok) throw new Error(`publish ${id} failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
}

// ── --probe: verify the server files petbody: under the 'pet' category ──────
// (Publishes a 1px probe, checks the cat=pet manifest contains it, deletes it.)
async function probe() {
    if (!ADMIN_PW) { console.error('probe needs ADMIN_PASSWORD'); process.exit(1); }
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await publish('petbody:deploy-probe', px);
    const r = await fetch(`${SERVER}/api/images?cat=pet&ids=1&cb=${Date.now()}`);
    const ids = r.ok ? await r.json() : [];
    const present = Array.isArray(ids) && ids.includes('petbody:deploy-probe');
    await fetch(`${SERVER}/api/images?id=${encodeURIComponent('petbody:deploy-probe')}`, {
        method: 'DELETE', headers: { 'x-admin-password': ADMIN_PW },
    }).catch(() => undefined);
    console.log(present
        ? 'PROBE OK — server files petbody: under the pet category (deploy is live).'
        : 'PROBE FAILED — petbody: not in the cat=pet manifest yet (server prefix change not deployed). Wait and re-probe.');
    process.exit(present ? 0 : 2);
}

async function main() {
    if (flags.probe) return probe();
    if (!OPENAI_KEY) { console.error('OPENAI_API_KEY not found (env or shinobij.client/.env)'); process.exit(1); }
    if (!flags['no-publish'] && !ADMIN_PW) { console.error('ADMIN_PASSWORD not found (needed to publish; use --no-publish to skip)'); process.exit(1); }

    console.log(`server:  ${SERVER}`);
    console.log(`gen:     gpt-image-1 edits 1024x1024 quality=${GEN_QUALITY} transparent`);
    console.log(`encode:  WebP max ${MAX_PX}px q${WEBP_Q}  →  ${path.relative(CLIENT_ROOT, OUT_DIR)}`);

    const registry = await fetchRegistry();
    const allKeys = Object.keys(registry);
    const portraitsByBase = new Map(); // baseId -> registry key to use as source
    for (const key of allKeys) {
        if (!key.startsWith('pet:')) continue;
        const baseId = stripVariant(key.slice(4));
        // Prefer the exact base-id key over a timestamped clone's key.
        if (!portraitsByBase.has(baseId) || key === `pet:${baseId}`) portraitsByBase.set(baseId, key);
    }
    const existingBodies = new Set(allKeys.filter((k) => k.startsWith('petbody:')).map((k) => stripVariant(k.slice(8))));

    const only = flags.only ? new Set(String(flags.only).split(',').map((s) => s.trim()).filter(Boolean)) : null;
    let work = [...portraitsByBase.entries()]
        .filter(([baseId]) => (only ? only.has(baseId) : true))
        .filter(([baseId]) => flags.force || !existingBodies.has(baseId))
        .filter(([baseId]) => flags.force || !fs.existsSync(path.join(OUT_DIR, `${baseId}.webp`)));
    work.sort((a, b) => a[0].localeCompare(b[0]));
    if (flags.limit) work = work.slice(0, Number(flags.limit));

    const estEach = GEN_QUALITY === 'high' ? 0.19 : GEN_QUALITY === 'medium' ? 0.07 : 0.02;
    console.log(`\nportraits found: ${portraitsByBase.size} | existing petbody: ${existingBodies.size} | to generate: ${work.length}`);
    console.log(`estimated OpenAI cost: ~$${(work.length * estEach).toFixed(2)} (${GEN_QUALITY})`);
    if (flags['dry-run']) {
        console.log('\n--dry-run worklist:');
        for (const [baseId] of work) console.log(`  ${baseId}`);
        return;
    }
    if (work.length === 0) { console.log('Nothing to do.'); return; }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const sharp = (await import('sharp')).default;
    const failures = [];
    const successes = [];
    let done = 0;

    async function processPet([baseId, srcKey]) {
        const label = `[${++done}/${work.length}] ${baseId}`;
        try {
            const raw = await valueToBytes(registry[srcKey], srcKey);
            if (!raw) throw new Error('could not resolve portrait bytes');
            // Normalize to PNG regardless of stored format (webp/jpeg/gif/…) so
            // the upload is always a supported, correctly-typed image.
            const bytes = await sharp(raw).png().toBuffer();

            // Up to 4 attempts: 429/5xx back off progressively (the org limit is
            // 5 input-images/min, so a 20-40s wait clears the window); a safety
            // rejection switches to the softer fallback prompt once.
            let png;
            let prompt = PROMPT;
            for (let attempt = 1; ; attempt++) {
                try {
                    png = await openaiEdit(bytes, prompt);
                    break;
                } catch (e) {
                    if (e.safety && prompt === PROMPT) {
                        console.log(`${label}: safety-rejected, retrying with softer prompt…`);
                        prompt = FALLBACK_PROMPT;
                    } else if ((e.status === 429 || e.status >= 500) && attempt < 4) {
                        await sleep(20_000 * attempt);
                    } else throw e;
                }
            }

            const webp = await sharp(png)
                .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: WEBP_Q, effort: 6 })
                .toBuffer();
            const outFile = path.join(OUT_DIR, `${baseId}.webp`);
            fs.writeFileSync(outFile, webp);

            if (!flags['no-publish']) {
                await publish(`petbody:${baseId}`, `data:image/webp;base64,${webp.toString('base64')}`);
            }
            successes.push(baseId);
            console.log(`${label}: ok (${(webp.length / 1024).toFixed(0)} KB)${flags['no-publish'] ? ' [local only]' : ' [published]'}`);
        } catch (e) {
            failures.push({ id: baseId, error: String(e.message ?? e) });
            console.error(`${label}: FAILED — ${e.message ?? e}`);
        }
    }

    // Tiny worker pool.
    const queue = [...work];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            if (item) await processPet(item);
            await sleep(400); // gentle pacing between calls per worker
        }
    }));

    // Review sheet: before (prod portrait) vs after (local sprite).
    const rows = successes.sort().map((id) => `
      <div class="row"><div class="name">${id}</div>
        <img class="before" src="${SERVER}/api/img?id=${encodeURIComponent(`pet:${id}`)}" loading="lazy">
        <img class="after" src="./${id}.webp" loading="lazy"></div>`).join('');
    fs.writeFileSync(path.join(OUT_DIR, 'review.html'), `<!doctype html><meta charset="utf-8"><title>petbody review</title>
<style>body{background:#0f172a;color:#e2e8f0;font:14px system-ui;padding:16px}
.row{display:inline-block;width:300px;margin:8px;background:#1e293b;border-radius:8px;padding:8px;vertical-align:top}
.name{font-weight:700;margin-bottom:6px}.row img{width:140px;height:140px;object-fit:contain;background:
repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50%/20px 20px;border-radius:6px}
.after{margin-left:4px}</style><h2>petbody review — before (portrait) / after (battle sprite)</h2>${rows}`);

    if (failures.length) fs.writeFileSync(path.join(OUT_DIR, 'failures.json'), JSON.stringify(failures, null, 2));
    console.log(`\nDONE: ${successes.length} ok, ${failures.length} failed.`);
    console.log(`review:  ${path.join(OUT_DIR, 'review.html')}`);
    if (failures.length) console.log(`retry:   node scripts/gen-pet-battle-sprites.mjs --only ${failures.map((f) => f.id).join(',')} --force`);
}

main().catch((err) => { console.error(err?.stack || String(err)); process.exitCode = 1; });
