// Publish already-generated AOE Burst jutsu art to the shared image store.
//
// gen-aoe-art.mjs writes WebP files to asset-gen-out/jutsu/. This script POSTs each
// to /api/images under its `jutsu:<id>` key (the same call the admin panel makes),
// so the client hydrates them into sharedImages on load and they render everywhere —
// battle, cards, admin panel. Publishing existing files = zero extra OpenAI spend.
//
// Run from shinobij.client/ (ADMIN_PASSWORD read from env or .env):
//   node scripts/publish-aoe-art.mjs --dry-run
//   node scripts/publish-aoe-art.mjs --server https://shinobijourney.com   # LIVE store
//
// Pick the target deliberately: a local server only populates local storage; the
// production URL writes to the live bucket every player + the admin panel reads.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const ART_DIR = path.join(CLIENT_ROOT, 'asset-gen-out', 'jutsu');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const dryRun = process.argv.includes('--dry-run');
const server = arg('server', 'http://localhost:5173').replace(/\/$/, '');

function resolveAdminPassword() {
    if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
    const dotenv = path.join(CLIENT_ROOT, '.env');
    if (fs.existsSync(dotenv)) {
        for (const line of fs.readFileSync(dotenv, 'utf8').split('\n')) {
            const m = line.match(/^ADMIN_PASSWORD\s*=\s*(.+)$/);
            if (m) return m[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

// Only the AOE Burst set (the -aoe variant across every discipline × element).
const files = fs.existsSync(ART_DIR)
    ? fs.readdirSync(ART_DIR).filter((f) => /^starter-(nin|tai|gen|buki)-(earth|wind|lightning|fire|water)-aoe\.webp$/.test(f))
    : [];

if (!files.length) {
    console.error(`error: no AOE Burst webp files in ${path.relative(CLIENT_ROOT, ART_DIR)}. Run gen-aoe-art.mjs first.`);
    process.exit(1);
}

console.log(`target:  ${server}`);
console.log(`files:   ${files.length}`);
if (dryRun) {
    for (const f of files) console.log(`  would publish jutsu:${f.replace(/\.webp$/, '')}`);
    console.log('\n--dry-run: nothing sent.');
    process.exit(0);
}

const adminPw = resolveAdminPassword();
if (!adminPw) {
    console.error('error: ADMIN_PASSWORD not found in env or shinobij.client/.env — the /api/images write is admin-gated.');
    process.exit(1);
}

let ok = 0;
let failed = 0;
for (const f of files) {
    const id = `jutsu:${f.replace(/\.webp$/, '')}`;
    const b64 = fs.readFileSync(path.join(ART_DIR, f)).toString('base64');
    const dataUrl = `data:image/webp;base64,${b64}`;
    try {
        const res = await fetch(`${server}/api/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
            body: JSON.stringify({ id, image: dataUrl }),
        });
        if (res.ok) { ok++; console.log(`ok    ${id}  →  ${server}/api/img?id=${encodeURIComponent(id)}`); }
        else { failed++; console.error(`FAIL  ${id}  (${res.status}) ${(await res.text().catch(() => '')).slice(0, 160)}`); }
    } catch (err) {
        failed++;
        console.error(`FAIL  ${id}  ${err instanceof Error ? err.message : String(err)}`);
    }
}
console.log(`\n════ published ${ok}/${files.length}${failed ? `, ${failed} failed` : ''} ════`);
if (failed) process.exitCode = 1;
