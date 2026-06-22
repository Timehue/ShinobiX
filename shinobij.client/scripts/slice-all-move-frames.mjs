// Slice EVERY generated move-frame sheet into public/pet-poses, then regenerate
// POSED_MOVE_IDS in the manifest to the set of pets that ended up with all 4
// frames (windup/lunge/impact/recover). Run after gen-all-pet-moveframes.mjs.
//
//   node scripts/slice-all-move-frames.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const SHEETS = path.join(CLIENT, 'asset-gen-out', 'pet-moveframes');
const OUT = path.join(CLIENT, 'public', 'pet-poses');
const CATS = ['windup', 'lunge', 'impact', 'recover'];

const sheets = fs.readdirSync(SHEETS).filter((f) => f.endsWith('-moves.png') && !f.endsWith('-pilot-moves.png'));
console.log(`slicing ${sheets.length} sheets…`);
let ok = 0, fail = 0; const failed = [];
for (const f of sheets) {
    const id = f.replace(/-moves\.png$/, '');
    try {
        execFileSync('node', ['scripts/slice-move-frames.mjs', '--in', `asset-gen-out/pet-moveframes/${f}`, '--out-name', id, '--out-dir', 'public/pet-poses'], { cwd: CLIENT, stdio: 'pipe', timeout: 60000 });
        if (CATS.every((c) => fs.existsSync(path.join(OUT, `${id}-${c}.webp`)))) ok++;
        else { fail++; failed.push(id); console.warn(`  incomplete: ${id}`); }
    } catch (e) { fail++; failed.push(id); console.error(`  slice fail ${id}: ${String(e.message).slice(0, 100)}`); }
}
console.log(`sliced: ${ok} ok, ${fail} fail`);

// Regenerate POSED_MOVE_IDS = pets that have all 4 frames on disk.
const ids = [];
for (const f of fs.readdirSync(OUT)) {
    const m = f.match(/^(.+)-windup\.webp$/);
    if (m && CATS.every((c) => fs.existsSync(path.join(OUT, `${m[1]}-${c}.webp`)))) ids.push(m[1]);
}
ids.sort();
const manifestPath = path.join(CLIENT, 'src', 'assets', 'coliseum', 'pet-poses-manifest.ts');
let mf = fs.readFileSync(manifestPath, 'utf8');
mf = mf.replace(/export const POSED_MOVE_IDS: ReadonlySet<string> = new Set\(\[[\s\S]*?\]\);/, `export const POSED_MOVE_IDS: ReadonlySet<string> = new Set(${JSON.stringify(ids)});`);
fs.writeFileSync(manifestPath, mf);
console.log(`POSED_MOVE_IDS: ${ids.length} pets`);
if (failed.length) fs.writeFileSync(path.join(SHEETS, '_slice_failed.json'), JSON.stringify(failed, null, 2));
