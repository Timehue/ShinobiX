import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const distDir = process.env.BUILD_SIZE_DIR || join(process.cwd(), 'shinobij.client', 'dist');

const JS_CHUNK_FAIL_BYTES = 1_500_000;
const CSS_FILE_FAIL_BYTES = 750_000;
const TOTAL_JS_CSS_WARN_BYTES = 3_000_000;

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
for (const file of js) {
    if (file.size > JS_CHUNK_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; JS chunk threshold is ${fmt(JS_CHUNK_FAIL_BYTES)}`);
}
for (const file of css) {
    if (file.size > CSS_FILE_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; CSS file threshold is ${fmt(CSS_FILE_FAIL_BYTES)}`);
}

if (jsCssTotal > TOTAL_JS_CSS_WARN_BYTES) {
    console.warn(`[sizecheck] WARN total JS/CSS is ${fmt(jsCssTotal)}. Current threshold is observational; tighten once a release baseline is pinned.`);
}

if (failures.length) {
    console.error('[sizecheck] Build size budget failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log(`[sizecheck] PASS. Total JS/CSS: ${fmt(jsCssTotal)}.`);
