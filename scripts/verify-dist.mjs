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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverJs = join(root, 'dist', 'server.js');
const clientDist = join(root, 'shinobij.client', 'dist');
const vercelJson = join(root, 'vercel.json');
const forbiddenClientPrefixes = [
    'pet-models/qa/',
    'pet-models/sources/',
    'pet-models/proofs/',
    'pet-models/roster-concepts/',
    'pet-models/roster-references/',
];
// Authoring/intermediate formats that must never reach the runtime artifact.
// The public/ copy filter is a DENYLIST of five `pet-models/*` prefixes, so an
// authoring folder added anywhere else in public/ ships by default and nothing
// upstream objects; this extension gate is the format-level backstop for that.
//
// Deliberately NOT listed: `.wav`. The 25 SFX/ambience masters under
// sfx/production are a real runtime fallback — src/lib/audio-delivery.ts serves
// the .ogg (gapless Vorbis) or .m4a (WebKit) sibling and falls back to the
// master when a browser decodes neither, or when a deploy is missing siblings.
// Players fetch ~1.1 MB of .ogg, not the 13.6 MB of masters. Banning .wav here
// would delete a documented safety net to save deploy size only.
const forbiddenClientExtensions = new Set([
    // 2D authoring
    '.psd', '.kra', '.xcf', '.ai', '.sketch', '.afphoto', '.afdesign',
    '.tif', '.tiff', '.exr', '.tga', '.dng', '.cr2',
    // 3D authoring
    '.blend', '.blend1', '.blend2', '.fbx', '.obj', '.mtl', '.dae',
    '.max', '.ma', '.mb', '.c4d', '.ztl',
    // audio/video authoring projects and lossless intermediates
    '.aiff', '.aif', '.flac', '.als', '.flp', '.rpp', '.aup3', '.aep', '.prproj',
]);
const requiredClientFiles = [
    'pet-models/gate-warden-rigged.glb',
    'pet-models/ward-totem.glb',
    'pet-models/wf-boulder.glb',
    'pet-models/wf-lantern.glb',
];
const maxClientArtifactBytes = 512 * 1024 * 1024;

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

if (existsSync(vercelJson)) {
    fail('vercel.json must not be present. Vercel is retired for this project.');
}

if (!existsSync(clientDist)) {
    fail('shinobij.client/dist is missing. Run the client build before release verification.');
}

function walkFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(full));
        else files.push(full);
    }
    return files;
}

const clientFiles = walkFiles(clientDist);
const clientRelativeFiles = clientFiles.map((file) => relative(clientDist, file).replaceAll('\\', '/'));
const clientRelativeFileSet = new Set(clientRelativeFiles);
const clientIndex = readFileSync(join(clientDist, 'index.html'), 'utf8');
const referencedClientAssets = [...clientIndex.matchAll(/(?:src|href)=["']\/([^"']+)["']/g)].map((match) => match[1]);
const missingReferencedClientAsset = referencedClientAssets.find((file) => !clientRelativeFileSet.has(file));
if (missingReferencedClientAsset) fail(`client index references a missing built asset: ${missingReferencedClientAsset}`);
const missingRequiredClientFile = requiredClientFiles.find((file) => !clientRelativeFileSet.has(file));
if (missingRequiredClientFile) fail(`client dist is missing required runtime asset: ${missingRequiredClientFile}`);
/*
 * Compressed delivery siblings must survive into the SHIPPED dist, not merely
 * exist in public/. The unit tests assert the public/ side; only this check sees
 * what the build actually emitted, which is where an ignore rule or a copy step
 * would silently drop them — the same shape as the prod-only GLB 404s.
 *
 * A missing sibling is never silence at runtime (the loaders fall back), but it
 * costs a player up to 12x the bytes for audio and ~3.5x for card art, which is
 * exactly the kind of regression nothing else would surface.
 */
const deliveryGaps = [];
for (const file of clientRelativeFiles) {
    if (file.startsWith('sfx/production/') && file.endsWith('.wav')) {
        for (const ext of ['.ogg', '.m4a']) {
            const sibling = file.replace(/\.wav$/, ext);
            if (!clientRelativeFileSet.has(sibling)) deliveryGaps.push(sibling);
        }
    } else if (file.startsWith('music/') && file.endsWith('.ogg')) {
        // WebKit decodes no Ogg container at all, so the .m4a is the only thing
        // standing between an iOS player and silence.
        const sibling = file.replace(/\.ogg$/, '.m4a');
        if (!clientRelativeFileSet.has(sibling)) deliveryGaps.push(sibling);
    } else if (file.startsWith('chronicle/cards/') && file.endsWith('.webp') && !file.endsWith('-512.webp')) {
        const sibling = file.replace(/\.webp$/, '-512.webp');
        if (!clientRelativeFileSet.has(sibling)) deliveryGaps.push(sibling);
    }
}
if (deliveryGaps.length) {
    fail(
        `client dist is missing ${deliveryGaps.length} compressed delivery file(s), e.g. ${deliveryGaps.slice(0, 3).join(', ')}. `
        + 'Regenerate with `npm run gen:audio` / `npm run gen:card-variants` in shinobij.client.',
    );
}

const leakedAuthoringPath = clientRelativeFiles.find((file) => forbiddenClientPrefixes.some((prefix) => file.startsWith(prefix)));
if (leakedAuthoringPath) fail(`client dist contains pet authoring output: ${leakedAuthoringPath}`);
const leakedSourceFile = clientRelativeFiles.find((file) => {
    const dot = file.lastIndexOf('.');
    return dot >= 0 && forbiddenClientExtensions.has(file.slice(dot).toLowerCase());
});
if (leakedSourceFile) fail(`client dist contains an authoring source file: ${leakedSourceFile}`);

const clientArtifactBytes = clientFiles.reduce((total, file) => total + statSync(file).size, 0);
if (clientArtifactBytes > maxClientArtifactBytes) {
    fail(`client dist is ${(clientArtifactBytes / 1024 / 1024).toFixed(1)} MB; runtime artifact ceiling is ${maxClientArtifactBytes / 1024 / 1024} MB`);
}

console.log(`[verify:dist] OK — server ${(st.size / 1024).toFixed(1)} KB; client ${(clientArtifactBytes / 1024 / 1024).toFixed(1)} MB with no authoring sources; Vercel config absent.`);
