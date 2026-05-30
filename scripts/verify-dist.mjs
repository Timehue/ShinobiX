/**
 * Post-build sanity check for the cPanel/Passenger bundle.
 *
 * `dist/` is committed and served by Passenger (app.js → require('./dist/server.js')),
 * and `tsconfig.cpanel.json` sets noEmitOnError:false so a broken or empty
 * compile can still leave a half-written server.js behind. This guard runs at
 * the end of `npm run build` and fails the build LOUDLY if the server bundle is
 * missing or obviously truncated — far better than committing a stale/broken
 * dist and discovering it only when cPanel serves 502s.
 *
 * It is a smoke check, not a full validation: it verifies the file exists, is
 * non-trivial in size, and contains the expected Express wiring markers.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverJs = join(root, 'dist', 'server.js');

function fail(msg) {
    console.error(`\n[verify:dist] FAILED — ${msg}\n`);
    process.exit(1);
}

let st;
try {
    st = statSync(serverJs);
} catch {
    fail(`dist/server.js not found. Run "npm run build:server" — the cPanel bundle was never produced.`);
}

if (!st.isFile() || st.size < 1024) {
    fail(`dist/server.js is suspiciously small (${st?.size ?? 0} bytes) — the build likely produced an empty/truncated bundle.`);
}

const src = readFileSync(serverJs, 'utf8');
// The compiled server must wire Express and start listening. If these are
// missing the bundle is broken even though the file exists.
const markers = ['express', 'listen'];
const missing = markers.filter((m) => !src.includes(m));
if (missing.length) {
    fail(`dist/server.js is missing expected markers: ${missing.join(', ')}. The compile is incomplete.`);
}

console.log(`[verify:dist] OK — dist/server.js present (${(st.size / 1024).toFixed(1)} KB), Express wiring intact.`);
