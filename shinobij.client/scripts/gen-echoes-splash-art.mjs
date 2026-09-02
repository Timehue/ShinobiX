// One-off generator for the Echoes of War matchup-splash art: the
// challenger-fallback figure shown for players with no uploaded avatar.
// Written straight into public/ (repo-committed fixed asset, same as the
// portrait set). Idempotent: existing files are skipped.
//
//   OPENAI_API_KEY=... node scripts/gen-echoes-splash-art.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
    console.error('OPENAI_API_KEY is required (read it from the main checkout .env).');
    process.exit(1);
}

const STYLE = 'Polished 2D anime shinobi RPG game asset, painted illustration, dramatic lighting, family-friendly, no text, no logos, no watermark, no UI.';

const PIECES = [
    ['echoes-challenger',
     'A lone shinobi challenger seen from a three-quarter back angle, hooded travel cloak over practical dark gear, face mostly in shadow with only a determined jaw catching light, looking up toward a warm golden glow high above, ember motes rising around them, strong golden rim light against deep shadow, the base of a vast ancient stone tower behind, heroic and resolute.',
     '1024x1536', 640],
];

async function generate(prompt, size) {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size, quality: 'medium', n: 1 }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    return Buffer.from(data.data[0].b64_json, 'base64');
}

const dir = path.join(CLIENT, 'public', 'portraits');
fs.mkdirSync(dir, { recursive: true });
for (const [id, brief, size, width] of PIECES) {
    const outPath = path.join(dir, `${id}.webp`);
    if (fs.existsSync(outPath)) { console.log(`skip ${id} (exists)`); continue; }
    console.log(`generating ${id}...`);
    const buffer = await generate(`${STYLE} ${brief}`, size);
    const { default: sharp } = await import('sharp');
    await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toFile(outPath);
    console.log(`wrote ${outPath}`);
}
console.log('done');
