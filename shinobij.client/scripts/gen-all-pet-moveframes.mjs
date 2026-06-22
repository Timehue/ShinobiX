// Batch-generate the 4-frame ATTACK SEQUENCE sheet for the WHOLE roster, using
// each pet's shipped idle pose as the reference. Resumable (skips done), retries
// 3×, serial + courtesy delay for rate limits. Needs FAL_KEY in env.
//
//   FAL_KEY=... node scripts/gen-all-pet-moveframes.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const POSES_DIR = path.join(CLIENT, 'public', 'pet-poses');
const OUT = path.join(CLIENT, 'asset-gen-out', 'pet-moveframes');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '_progress.log');
const log = (m) => { console.log(m); fs.appendFileSync(LOG, m + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = fs.readdirSync(POSES_DIR).filter((f) => f.endsWith('-idle.webp')).map((f) => f.replace(/-idle\.webp$/, '')).sort();
log(`=== move-frame batch: ${ids.length} pets ===`);
let done = 0, skip = 0, fail = 0; const failed = [];
for (const id of ids) {
    if (fs.existsSync(path.join(OUT, `${id}-moves.png`))) { skip++; continue; }
    const src = path.join(POSES_DIR, `${id}-idle.webp`);
    let ok = false;
    for (let a = 1; a <= 3 && !ok; a++) {
        try { execFileSync('node', ['scripts/gen-pet-moveframes.mjs', '--id', id, '--src', src], { cwd: CLIENT, stdio: 'pipe', timeout: 150000 }); ok = true; }
        catch (e) { log(`  retry ${id} (${a}/3): ${String(e.stderr || e.message).slice(0, 140).replace(/\n/g, ' ')}`); await sleep(8000); }
    }
    if (ok) { done++; log(`[${done + skip}/${ids.length}] ok ${id}`); } else { fail++; failed.push(id); log(`[FAIL] ${id}`); }
    await sleep(2000);
}
fs.writeFileSync(path.join(OUT, '_failed.json'), JSON.stringify(failed, null, 2));
log(`=== DONE: ${done} gen, ${skip} skip, ${fail} fail ===`);
