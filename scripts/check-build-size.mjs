import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDir = process.env.BUILD_SIZE_DIR || join(process.cwd(), 'shinobij.client', 'dist');

const JS_CHUNK_FAIL_BYTES = 1_500_000;
const CSS_FILE_FAIL_BYTES = 750_000;
const TOTAL_JS_CSS_WARN_BYTES = 3_000_000;
// All emitted product JS/CSS includes lazy 3D/gameplay chunks and production
// build-arg code that is not always present in local builds. Keep startup gates
// below strict; allow a small ceiling bump for the intentional pet evolution
// 2.5D stage and env-injected deploy variance.
const TOTAL_JS_CSS_FAIL_BYTES = 6_100_000;
// Ratcheted 2026-07-17 (twice) after the story-graph lazy split: first
// lib/story-trigger-loader.ts moved the interlude/epilogue prose off the entry
// chunk (entry 1,031→795 KB), then data/story-boss-meta.ts freed combat-ai
// from data/storylines so the chapter prose left too (795→581 KB; initial
// gzip ~497→340 KB). ~10-13% headroom over the measured build — lower these
// again when the next drain lands, never raise them to "fix" a regression.
const ENTRY_JS_FAIL_BYTES = 660_000;
const INITIAL_GRAPH_FAIL_BYTES = 1_500_000;
const INITIAL_GRAPH_GZIP_FAIL_BYTES = 385_000;
const SENTRY_VENDOR_FAIL_BYTES = 100_000;
const SENTRY_VENDOR_RE = /^assets\/sentry-vendor-[^/]+\.js$/;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else out.push({ path: full, size: st.size });
    }
    return out;
}

function fmt(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

let files;
try {
    files = walk(distDir);
} catch (err) {
    console.error(`[sizecheck] Could not read ${distDir}. Run the client build first.`);
    console.error(`[sizecheck] ${err.message}`);
    process.exit(1);
}

const withRel = files
    .map((file) => ({ ...file, rel: relative(distDir, file.path).replaceAll('\\', '/') }))
    .sort((a, b) => b.size - a.size);

console.log('[sizecheck] Top 20 dist assets:');
for (const file of withRel.slice(0, 20)) {
    console.log(`  ${fmt(file.size).padStart(9)}  ${file.rel}`);
}

const js = withRel.filter((file) => file.rel.endsWith('.js'));
const css = withRel.filter((file) => file.rel.endsWith('.css'));
const jsCssTotal = [...js, ...css].reduce((sum, file) => sum + file.size, 0);
const failures = [];
const sentryChunks = js.filter((file) => SENTRY_VENDOR_RE.test(file.rel));
const budgetedJsCssTotal = [
    ...js.filter((file) => !SENTRY_VENDOR_RE.test(file.rel)),
    ...css,
].reduce((sum, file) => sum + file.size, 0);

// Sentry is observability, not product code. Allow one tightly capped chunk only
// when it stays off the initial graph; do not weaken the product-code budget.
if (sentryChunks.length > 1) failures.push(`expected at most one lazy Sentry vendor chunk; found ${sentryChunks.length}`);
for (const file of sentryChunks) {
    if (file.size > SENTRY_VENDOR_FAIL_BYTES) {
        failures.push(`${file.rel} is ${fmt(file.size)}; lazy Sentry threshold is ${fmt(SENTRY_VENDOR_FAIL_BYTES)}`);
    }
}
for (const file of js) {
    if (file.size > JS_CHUNK_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; JS chunk threshold is ${fmt(JS_CHUNK_FAIL_BYTES)}`);
}
for (const file of css) {
    if (file.size > CSS_FILE_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; CSS file threshold is ${fmt(CSS_FILE_FAIL_BYTES)}`);
}

// Budget what every player must download before the first lazy screen. Generic
// per-chunk ceilings missed regressions in the entry + render-blocking CSS graph.
try {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const initialRefs = [...new Set(
        [...html.matchAll(/(?:src|href)="\/([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g)].map((match) => match[1]),
    )];
    const initialFiles = initialRefs.map((rel) => ({ rel, path: join(distDir, rel), size: statSync(join(distDir, rel)).size }));
    const initialRaw = initialFiles.reduce((sum, file) => sum + file.size, 0);
    const initialGzip = initialFiles.reduce((sum, file) => sum + gzipSync(readFileSync(file.path), { level: 9 }).length, 0);
    const entryRef = [...html.matchAll(/<script[^>]+src="\/([^"?]+\.js)/g)][0]?.[1];
    const entryFile = initialFiles.find((file) => file.rel === entryRef);

    console.log(`[sizecheck] Initial JS/CSS graph: ${fmt(initialRaw)} raw / ${fmt(initialGzip)} gzip across ${initialFiles.length} files.`);
    if (initialRefs.some((rel) => SENTRY_VENDOR_RE.test(rel))) {
        failures.push('lazy Sentry vendor is referenced by index.html and would delay healthy-player startup');
    }
    if (entryFile && entryFile.size > ENTRY_JS_FAIL_BYTES) {
        failures.push(`${entryFile.rel} is ${fmt(entryFile.size)}; entry JS threshold is ${fmt(ENTRY_JS_FAIL_BYTES)}`);
    }
    if (initialRaw > INITIAL_GRAPH_FAIL_BYTES) {
        failures.push(`initial JS/CSS graph is ${fmt(initialRaw)}; threshold is ${fmt(INITIAL_GRAPH_FAIL_BYTES)}`);
    }
    if (initialGzip > INITIAL_GRAPH_GZIP_FAIL_BYTES) {
        failures.push(`initial JS/CSS graph is ${fmt(initialGzip)} gzip; threshold is ${fmt(INITIAL_GRAPH_GZIP_FAIL_BYTES)}`);
    }
} catch (err) {
    failures.push(`could not measure initial index.html graph: ${err.message}`);
}

if (budgetedJsCssTotal > TOTAL_JS_CSS_WARN_BYTES) {
    console.warn(`[sizecheck] WARN budgeted product JS/CSS is ${fmt(budgetedJsCssTotal)} (all emitted: ${fmt(jsCssTotal)}).`);
}
if (budgetedJsCssTotal > TOTAL_JS_CSS_FAIL_BYTES) {
    failures.push(`budgeted product JS/CSS is ${fmt(budgetedJsCssTotal)}; threshold is ${fmt(TOTAL_JS_CSS_FAIL_BYTES)}`);
}

if (failures.length) {
    console.error('[sizecheck] Build size budget failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

const sentryNote = sentryChunks.length ? `; lazy Sentry: ${fmt(sentryChunks[0].size)}` : '';
console.log(`[sizecheck] PASS. Budgeted product JS/CSS: ${fmt(budgetedJsCssTotal)}; all emitted: ${fmt(jsCssTotal)}${sentryNote}.`);
