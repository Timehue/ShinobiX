// One-off: generate + publish PORTRAITS (pet:<id>) for the built-in Central
// Pet Arena AI opponents, which shipped without any art (the "AR" placeholder
// cards in battle). After this, run the existing battle-sprite pipeline —
//   node scripts/gen-pet-battle-sprites.mjs
// — which automatically picks up any pet: portrait lacking a petbody: sprite.
//
//   node scripts/gen-ai-opponent-art.mjs [--dry-run] [--force]
//
// Keys: OPENAI_API_KEY + ADMIN_PASSWORD from env or shinobij.client/.env.
// Skips opponents whose pet:<id> already exists in the registry unless --force.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(CLIENT_ROOT, 'asset-gen-out', 'ai-opponents');
const SERVER = 'https://shinobijourney.com';

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

const OPENAI_KEY = envFromDotenv('OPENAI_API_KEY');
const ADMIN_PW = envFromDotenv('ADMIN_PASSWORD');
const flags = new Set(process.argv.slice(2));

// Matches src/data/pet-arena-opponents.ts (names + descriptions drive prompts).
const OPPONENTS = [
    {
        id: 'generic-ai-pet-sparrow',
        name: 'Arena Sparrow',
        prompt: 'A small swift brown sparrow creature with sharp talons, ruffled wind-blown feathers and a tiny ninja headband, perched alert and ready to dart, arena sand and stone behind it',
    },
    {
        id: 'generic-ai-pet-guardhound',
        name: 'Arena Guardhound',
        prompt: 'A sturdy armored guard hound creature with iron plate armor, a protective collar shield and a calm resolute expression, standing firm, arena sand and stone behind it',
    },
    {
        id: 'generic-ai-pet-emberlynx',
        name: 'Arena Emberlynx',
        prompt: 'A legendary lynx creature wreathed in gentle embers, glowing amber eyes, flame-tipped ears and tail, poised and regal, arena sand and stone behind it',
    },
];

// Same style wrapper as scripts/gen-asset.mjs so the portraits match the look
// of art authored through the admin panel.
function styleWrap(prompt, label) {
    return `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;
}

async function main() {
    if (!OPENAI_KEY || !ADMIN_PW) { console.error('OPENAI_API_KEY / ADMIN_PASSWORD missing'); process.exit(1); }
    const sharp = (await import('sharp')).default;
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Skip already-published portraits (idempotent).
    const r = await fetch(`${SERVER}/api/images?cat=pet&ids=1&cb=${Date.now()}`);
    const existing = new Set(r.ok ? await r.json() : []);

    for (const p of OPPONENTS) {
        if (!flags.has('--force') && existing.has(`pet:${p.id}`)) { console.log(`${p.id}: portrait already published — skip`); continue; }
        if (flags.has('--dry-run')) { console.log(`${p.id}: would generate (${p.name})`); continue; }
        const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-image-1', prompt: styleWrap(p.prompt, `pet:${p.id}`), size: '1024x1024', quality: 'medium', n: 1 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { console.error(`${p.id}: OpenAI ${res.status} ${data?.error?.message ?? ''}`); continue; }
        const png = Buffer.from(data.data[0].b64_json, 'base64');
        const webp = await sharp(png).resize({ width: 512, height: 512, fit: 'inside' }).webp({ quality: 80, effort: 6 }).toBuffer();
        fs.writeFileSync(path.join(OUT_DIR, `${p.id}.webp`), webp);
        const pub = await fetch(`${SERVER}/api/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': ADMIN_PW },
            body: JSON.stringify({ id: `pet:${p.id}`, image: `data:image/webp;base64,${webp.toString('base64')}` }),
        });
        console.log(`${p.id}: generated ${(webp.length / 1024) | 0}KB, publish ${pub.ok ? 'ok' : 'FAILED ' + pub.status}`);
    }
    console.log('\nNext: node scripts/gen-pet-battle-sprites.mjs   (picks up the new portraits automatically)');
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exitCode = 1; });
