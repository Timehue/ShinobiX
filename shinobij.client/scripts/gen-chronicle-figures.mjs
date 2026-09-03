// Cut-out creature figures for the Chronicle duel board: every monster in
// the ten Echoes of War decks plus the starter/fallback pool gets its
// creature isolated from its own card art onto a transparent background
// (images/edits, gpt-image-1), so a summoned attacker can stand on the
// raked stage as a figure instead of a framed card. Written straight into
// public/chronicle/figures/ (repo-committed fixed assets). Idempotent and
// resumable: existing files are skipped, failures are logged and retried
// on the next run.
//
//   OPENAI_API_KEY=... node --import tsx scripts/gen-chronicle-figures.mjs
//
// (tsx is needed because the id set is derived live from the catalog and
// the Echoes encounter decks, so the set can never drift from the game.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const ROOT = path.resolve(CLIENT, '..');
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
    console.error('OPENAI_API_KEY is required (read it from the main checkout .env).');
    process.exit(1);
}

const { ECHOES_ENCOUNTERS } = await import(pathToFileURL(path.join(ROOT, 'api/card-clash/_echoes-catalog.ts')).href);
const { CHRONICLE_CARD_CATALOG, CHRONICLE_FIXED_FALLBACK_DECK } = await import(pathToFileURL(path.join(CLIENT, 'src/lib/chronicle-duel.ts')).href);

const byId = new Map(CHRONICLE_CARD_CATALOG.map((card) => [card.id, card]));
const ids = new Set();
for (const encounter of ECHOES_ENCOUNTERS) {
    for (const id of encounter.deck) if (byId.get(id)?.cardClass === 'monster') ids.add(id);
}
for (const id of CHRONICLE_FIXED_FALLBACK_DECK) if (byId.get(id)?.cardClass === 'monster') ids.add(id);

const PROMPT =
    'Isolate the single main creature or character from this card artwork onto a fully transparent background. ' +
    'Keep the exact same painting style, colors, lighting, pose and details as the original. ' +
    'Remove the entire background, scenery and any frame completely. ' +
    'Show the full body where possible, grounded at the bottom of the image. No text, no logos, no watermark.';

// Player-side variant: the same creature seen from behind, so the player's
// own summons read as facing up-field at the enemy (the Duel Links stage
// convention). Fed from the finished front cut-out to keep identity.
const BACK_PROMPT =
    'Repaint this exact same creature or character seen from BEHIND, in a back view, facing away from the viewer ' +
    'toward the distance as if confronting an enemy far ahead. Same character, same equipment, same painting style, ' +
    'same colors and lighting. Fully transparent background, full body, grounded at the bottom of the image. ' +
    'No text, no logos, no watermark.';

const outDir = path.join(CLIENT, 'public', 'chronicle', 'figures');
fs.mkdirSync(outDir, { recursive: true });

async function generateOne(id, variant = 'front') {
    const outPath = path.join(outDir, variant === 'back' ? `${id}-back.webp` : `${id}.webp`);
    if (fs.existsSync(outPath)) return 'skip';
    const srcPath = variant === 'back'
        ? path.join(outDir, `${id}.webp`)
        : path.join(CLIENT, 'public', 'chronicle', 'cards', `${id}.webp`);
    if (!fs.existsSync(srcPath)) throw new Error(`no source art: ${srcPath}`);
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('image', new Blob([fs.readFileSync(srcPath)], { type: 'image/webp' }), `${id}.webp`);
    form.append('prompt', variant === 'back' ? BACK_PROMPT : PROMPT);
    form.append('size', '1024x1536');
    form.append('background', 'transparent');
    form.append('quality', 'medium');
    const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}` },
        body: form,
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 220)}`);
    const data = await response.json();
    const buffer = Buffer.from(data.data[0].b64_json, 'base64');
    const { default: sharp } = await import('sharp');
    await sharp(buffer)
        .trim({ threshold: 8 })
        .resize({ height: 640, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(outPath);
    return 'ok';
}

const queue = [...ids].sort();
console.log(`figures needed: ${queue.length}`);
let done = 0;
let failed = 0;
const CONCURRENCY = 3;
async function worker(name) {
    for (;;) {
        const id = queue.shift();
        if (!id) return;
        try {
            const result = await generateOne(id);
            const backResult = await generateOne(id, 'back');
            done += 1;
            console.log(`[${done}/${ids.size}] ${result}/${backResult} ${id}`);
        } catch (error) {
            failed += 1;
            console.error(`FAIL ${id}: ${String(error).slice(0, 200)}`);
        }
    }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(String(i))));
console.log(`figures complete: ${done} done, ${failed} failed (rerun to retry failures)`);
if (failed > 0) process.exitCode = 1;
