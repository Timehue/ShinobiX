// Batch-generate the pose flipbook for the WHOLE pet roster.
//
//   for every asset-gen-out/petbody/<id>.webp:
//     gen-pet-anim.mjs  (fal nano-banana → 4-pose sheet, ~$0.10)
//     slice-pet-poses.mjs (→ <id>-{idle,attack,hurt,cast}.webp in the staging dir)
//
// Resumable (skips ids already sliced), retries each up to 3×, logs progress to
// asset-gen-out/pet-poses-all/_progress.log. Serial + a courtesy delay so we
// don't trip rate limits. Run from shinobij.client/:
//
//   node scripts/gen-all-pet-poses.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const SRC = path.join(CLIENT, 'asset-gen-out', 'petbody');
const OUT = path.join(CLIENT, 'asset-gen-out', 'pet-poses-all');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '_progress.log');
const log = (m) => { const line = `${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = fs.readdirSync(SRC).filter((f) => f.endsWith('.webp')).map((f) => f.replace(/\.webp$/, '')).sort();
log(`=== batch start: ${ids.length} pets ===`);

let done = 0, skip = 0, fail = 0;
const failed = [];
for (const id of ids) {
    if (fs.existsSync(path.join(OUT, `${id}-idle.webp`))) { skip++; continue; }
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
            execFileSync('node', ['scripts/gen-pet-anim.mjs', '--id', id], { cwd: CLIENT, stdio: 'pipe', timeout: 150000 });
            execFileSync('node', ['scripts/slice-pet-poses.mjs', '--in', `asset-gen-out/pet-anim/${id}-poses.png`, '--out-name', id, '--out-dir', OUT], { cwd: CLIENT, stdio: 'pipe', timeout: 60000 });
            ok = true;
        } catch (e) {
            const msg = String(e.stderr || e.message || e).slice(0, 160).replace(/\n/g, ' ');
            log(`  retry ${id} (${attempt}/3): ${msg}`);
            await sleep(10000);
        }
    }
    if (ok) { done++; log(`[${done + skip}/${ids.length}] ok ${id}`); }
    else { fail++; failed.push(id); log(`[FAIL] ${id}`); }
    await sleep(2500);
}
fs.writeFileSync(path.join(OUT, '_failed.json'), JSON.stringify(failed, null, 2));
log(`=== DONE: ${done} generated, ${skip} skipped, ${fail} failed ===`);
if (failed.length) log(`failed ids: ${failed.join(', ')}`);
