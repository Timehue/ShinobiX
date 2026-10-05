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
import { syncPetPoseManifest } from './pet-pose-manifest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const SHEETS = path.join(CLIENT, 'asset-gen-out', 'pet-moveframes');
const OUT = path.join(CLIENT, 'public', 'pet-poses');
const CATS = ['windup', 'lunge', 'impact', 'recover'];

// Share the complete formatter so neither generator can drop another export.
if (process.argv.includes('--manifest-only')) {
    const memberships = syncPetPoseManifest(CLIENT, { checkOnly: process.argv.includes('--check') });
    console.log(`[pose-manifest] ${process.argv.includes('--check') ? 'checked' : 'generated'} all three memberships: ${Object.values(memberships).map(ids => ids.length).join('/')}`);
    process.exit(0);
}

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

const memberships = syncPetPoseManifest(CLIENT);
console.log(`POSED_MOVE_IDS: ${memberships.POSED_MOVE_IDS.length} pets; complete manifest written`);
if (failed.length) fs.writeFileSync(path.join(SHEETS, '_slice_failed.json'), JSON.stringify(failed, null, 2));
