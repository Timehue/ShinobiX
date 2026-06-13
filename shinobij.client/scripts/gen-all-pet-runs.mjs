// Batch-generate the 2-frame RUN cycle for the WHOLE pet roster — the locomotion
// frames the combat sheet lacks (kills the "gliding" look).
//
//   for every asset-gen-out/petbody/<id>.webp lacking <id>-run-a.webp:
//     gen-pet-run.mjs   (fal nano-banana → 2-frame run sheet, ~$0.10)
//     slice-pet-poses.mjs --poses run-a,run-b  (→ <id>-run-{a,b}.webp staged)
//
// Resumable (skips ids already sliced), retries each up to 3×, and STOPS the
// whole run on a billing/quota error so a drained balance doesn't thrash. Serial
// + courtesy delay. Run from shinobij.client/:  node scripts/gen-all-pet-runs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const SRC = path.join(CLIENT, 'asset-gen-out', 'petbody');
const OUT = path.join(CLIENT, 'asset-gen-out', 'pet-poses-all'); // same staging as the combat sheet
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '_run-progress.log');
const log = (m) => { console.log(`${m}`); fs.appendFileSync(LOG, `${m}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBilling = (msg) => /\b(402|403)\b|balance|exhaust|quota|insufficient|payment|billing/i.test(msg);

const ids = fs.readdirSync(SRC).filter((f) => f.endsWith('.webp')).map((f) => f.replace(/\.webp$/, '')).sort();
log(`=== run-cycle batch start: ${ids.length} pets ===`);

let done = 0, skip = 0, fail = 0;
const failed = [];
for (const id of ids) {
    if (fs.existsSync(path.join(OUT, `${id}-run-a.webp`))) { skip++; continue; }
    let ok = false, billingStop = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
            execFileSync('node', ['scripts/gen-pet-run.mjs', '--id', id], { cwd: CLIENT, stdio: 'pipe', timeout: 150000 });
            execFileSync('node', ['scripts/slice-pet-poses.mjs', '--in', `asset-gen-out/pet-anim/${id}-run-poses.png`, '--out-name', id, '--poses', 'run-a,run-b', '--out-dir', OUT], { cwd: CLIENT, stdio: 'pipe', timeout: 60000 });
            ok = true;
        } catch (e) {
            const msg = String(e.stderr || e.message || e).slice(0, 200).replace(/\n/g, ' ');
            if (isBilling(msg)) { log(`  BILLING STOP at ${id}: ${msg}`); billingStop = true; break; }
            log(`  retry ${id} (${attempt}/3): ${msg}`);
            await sleep(10000);
        }
    }
    if (ok) { done++; log(`[${done + skip}/${ids.length}] ok ${id}`); }
    else { fail++; failed.push(id); log(`[FAIL] ${id}`); }
    if (billingStop) { log(`=== STOPPED (balance) after ${done} generated ===`); break; }
    await sleep(2500);
}
fs.writeFileSync(path.join(OUT, '_run-failed.json'), JSON.stringify(failed, null, 2));
log(`=== run-cycle DONE: ${done} generated, ${skip} skipped, ${fail} failed ===`);
if (failed.length) log(`failed ids: ${failed.join(', ')}`);
