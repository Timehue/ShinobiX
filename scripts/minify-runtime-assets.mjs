import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minifyRuntimeHtmlComments, minifyRuntimeJson, minifyRuntimeSource } from './runtime-asset-minifier.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const clientRoot = join(repoRoot, 'shinobij.client');

for (const name of ['boot-watchdog.js', 'sw.js']) {
    const sourcePath = join(clientRoot, 'public', name);
    const outputPath = join(clientRoot, 'dist', name);
    const source = readFileSync(sourcePath, 'utf8');
    const minified = minifyRuntimeSource(source);
    const before = Buffer.byteLength(source);
    const after = Buffer.byteLength(minified);
    if (after >= before) {
        throw new Error(`${name} minification did not reduce the production asset (${before} -> ${after} bytes)`);
    }
    writeFileSync(outputPath, minified);
    console.log(`[runtime-assets] ${name}: ${before} -> ${after} bytes (-${before - after})`);
}

// The manifest has no content hash in its filename. Keep its complete parsed
// graph for route-size checks and benchmarks while removing delivery whitespace.
// Content-hashed JSON assets must be compacted before Vite assigns their names.
const manifestPath = join(clientRoot, 'dist', '.vite', 'manifest.json');
const manifest = readFileSync(manifestPath, 'utf8');
const compactManifest = minifyRuntimeJson(manifest);
writeFileSync(manifestPath, compactManifest);
console.log(`[runtime-assets] .vite/manifest.json: ${Buffer.byteLength(manifest)} -> ${Buffer.byteLength(compactManifest)} bytes`);

// This runs before prerender-legal copies the shell into all nine legal pages.
// Leave markup, CSS, external scripts, CSP and the readable source unchanged.
const indexPath = join(clientRoot, 'dist', 'index.html');
const index = readFileSync(indexPath, 'utf8');
const compactIndex = minifyRuntimeHtmlComments(index);
writeFileSync(indexPath, compactIndex);
console.log(`[runtime-assets] index.html: ${Buffer.byteLength(index)} -> ${Buffer.byteLength(compactIndex)} bytes`);
