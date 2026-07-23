#!/usr/bin/env node
// Re-encode the pet-model GLBs with meshopt geometry compression + WebP textures.
//
// The roster/prop GLBs under shinobij.client/public/pet-models were exported raw
// from Blender: uncompressed float32 geometry + 2048² PNG textures, ~4 MB each and
// ~620 MB total. This pass runs each through `gltf-transform optimize` with:
//   • EXT_meshopt_compression + KHR_mesh_quantization  (geometry — ~5× smaller)
//   • EXT_texture_webp                                 (PNG → WebP, same resolution)
// and DELIBERATELY leaves `--simplify` OFF, so vertex counts and animation data are
// preserved exactly — the size win is compression, not decimation. Both extensions
// are decoded out-of-the-box by the client's loader (three-stdlib GLTFLoader +
// drei's bundled MeshoptDecoder; WebP is browser-native), so no runtime change is
// needed and nothing hits an external CDN (Draco would — it's intentionally avoided
// to stay within the app's strict CSP).
//
// Idempotent: files already carrying EXT_meshopt_compression are skipped, so this is
// safe to re-run and to point at a partially-processed tree.
//
// Setup (one-time, not a committed dependency — keeps it out of the Railway build):
//   npm install --no-save @gltf-transform/cli@4.4.1
// Usage:
//   node scripts/compress-pet-glbs.mjs [--dry-run]

import { readdirSync, statSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const MODELS_DIR = join(ROOT, 'shinobij.client', 'public', 'pet-models');
const DRY_RUN = process.argv.includes('--dry-run');

// Invoke the CLI's JS entry directly through `node` — not the .cmd/.ps1 shims and
// not npx — so it works regardless of shell and survives spaces in the repo path.
const CLI_JS = join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
if (!DRY_RUN && !existsSync(CLI_JS)) {
    console.error('gltf-transform CLI not found. Run:\n  npm install --no-save @gltf-transform/cli@4.4.1');
    process.exit(1);
}

const mb = (bytes) => (bytes / 1048576).toFixed(2) + ' MB';

function findGlbs(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...findGlbs(p));
        else if (entry.name.toLowerCase().endsWith('.glb')) out.push(p);
    }
    return out;
}

// Parse a GLB's JSON chunk and return its extensionsUsed[] without spawning a tool.
function extensionsUsed(file) {
    const buf = readFileSync(file);
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return []; // 'glTF' magic
    const jsonLen = buf.readUInt32LE(12);
    try {
        const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
        return Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
    } catch {
        return [];
    }
}

const files = findGlbs(MODELS_DIR).sort();
console.log(`Found ${files.length} GLB(s) under ${MODELS_DIR}\n`);

let beforeTotal = 0, afterTotal = 0, processed = 0, skipped = 0, failed = 0;

for (const file of files) {
    const rel = file.slice(ROOT.length + 1).replaceAll('\\', '/');
    const before = statSync(file).size;
    beforeTotal += before;

    if (extensionsUsed(file).includes('EXT_meshopt_compression')) {
        afterTotal += before;
        skipped++;
        console.log(`  skip   ${rel}  (already meshopt-compressed, ${mb(before)})`);
        continue;
    }
    if (DRY_RUN) {
        afterTotal += before;
        console.log(`  would  ${rel}  (${mb(before)})`);
        continue;
    }

    const tmp = join(tmpdir(), `glbc-${processed}-${Date.now()}.glb`);
    try {
        execFileSync(process.execPath, [CLI_JS, 'optimize', file, tmp,
            '--compress', 'meshopt',
            '--texture-compress', 'webp',
            '--simplify', 'false',
        ], { stdio: ['ignore', 'ignore', 'inherit'] });

        const after = statSync(tmp).size;
        // Guard: never replace a file with a larger or empty output.
        if (after === 0 || after >= before) {
            rmSync(tmp, { force: true });
            afterTotal += before;
            skipped++;
            console.log(`  keep   ${rel}  (re-encode not smaller: ${mb(before)} → ${mb(after)})`);
            continue;
        }
        renameSync(tmp, file);
        afterTotal += after;
        processed++;
        console.log(`  ok     ${rel}  ${mb(before)} → ${mb(after)}  (-${(100 * (1 - after / before)).toFixed(0)}%)`);
    } catch (err) {
        rmSync(tmp, { force: true });
        afterTotal += before;
        failed++;
        console.error(`  FAIL   ${rel}  — ${err.message.split('\n')[0]}`);
    }
}

console.log(`\n${DRY_RUN ? '[dry run] ' : ''}Done. processed=${processed} skipped=${skipped} failed=${failed}`);
console.log(`Total: ${mb(beforeTotal)} → ${mb(afterTotal)}  (-${(100 * (1 - afterTotal / beforeTotal)).toFixed(1)}%)`);
if (failed > 0) process.exitCode = 1;
