import { createHash } from 'node:crypto';
import { constants, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestedName = process.argv[2] ?? '.playwright-dist-4173';
const requestedSourceName = process.argv[3] ?? 'dist';

if (!['dist', 'dist-perf'].includes(requestedSourceName)) {
    throw new Error(`Unsafe Playwright preview source directory: ${requestedSourceName}`);
}

const sourceRoot = join(clientRoot, requestedSourceName);

if (!/^\.playwright-dist-[a-z0-9_-]+$/i.test(requestedName)) {
    throw new Error(`Unsafe Playwright preview directory: ${requestedName}`);
}

const targetRoot = join(clientRoot, requestedName);
export const SNAPSHOT_STATUS_FILE = '.playwright-snapshot-status.json';

// Hashing is bound by per-file latency, not bandwidth. The build is ~5,500 files,
// and on Windows every open pays a round trip through the real-time file scanner:
// hashing it one file at a time measured 50.0s, 16-wide 6.7s, and 32-wide 7.3s
// (2026-09-10, 484 MB). That sequential pass was the largest phase of the whole
// snapshot. Copying is deliberately NOT parallelised — it is write-bound and
// measured no faster 16-wide (14.4s against 11.5s sequential).
const HASH_CONCURRENCY = 16;

// stderr, never stdout. Playwright's webServer IGNORES a command's stdout by
// default (none of our configs override that), so this script's progress used to
// be silently swallowed: CI logs show vite's stderr warnings under [WebServer] but
// never a single line from here. That is why an over-budget snapshot surfaced as
// nothing but "Timed out waiting ... from config.webServer" with zero specs run —
// indistinguishable from a browser catastrophe. On stderr, the last line printed
// before a timeout names the phase that was still running.
function logProgress(line) {
    process.stderr.write(`${line}\n`);
}

async function timedPhase(log, label, work) {
    log(`[e2e] snapshot: ${label}…`);
    const started = performance.now();
    const result = await work();
    log(`[e2e] snapshot: ${label} done in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    return result;
}

// Runs `task` over `items` at most `limit` at a time, returning results in INPUT
// order whatever order they finish in. On the first failure it stops scheduling
// new work and waits for what is already in flight before rethrowing, so a
// rejection can never race a later write.
async function mapBounded(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    let failure = null;
    async function worker() {
        while (failure === null && next < items.length) {
            const index = next++;
            try {
                results[index] = await task(items[index]);
            } catch (error) {
                failure ??= { error };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    if (failure) throw failure.error;
    return results;
}

function copyTree(source, target, copyFile) {
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Snapshot source contains a symbolic link: ${source}`);
    if (stat.isDirectory()) {
        mkdirSync(target, { recursive: true });
        for (const entry of readdirSync(source).sort()) copyTree(join(source, entry), join(target, entry), copyFile);
        return;
    }
    if (!stat.isFile()) throw new Error(`Snapshot source contains an unsupported filesystem entry: ${source}`);

    // Clone-on-write avoids duplicating hundreds of MB where the filesystem
    // supports it; Node falls back to a normal copy on other platforms.
    copyFile(source, target, constants.COPYFILE_FICLONE);
}

export function validateSnapshot(root) {
    const indexPath = join(root, 'index.html');
    const assetsPath = join(root, 'assets');
    if (!existsSync(indexPath) || !existsSync(assetsPath)) return false;

    const html = readFileSync(indexPath, 'utf8');
    const localReferences = [...html.matchAll(/(?:src|href)="\/([^"?#]+)(?:[?#][^"]*)?"/g)]
        .map((match) => match[1]);
    return localReferences.length > 0
        && localReferences.every((relativePath) => existsSync(join(root, ...relativePath.split('/'))));
}

async function hashFile(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

export async function buildSnapshotManifest(root, ignoredRelativePaths = new Set()) {
    // Walk first, in the same depth-first, locale-sorted order as always, then hash
    // concurrently back INTO that order — so the manifest, and the manifestSha256
    // derived from it, are byte-identical to the sequential version.
    const files = [];
    function visit(absoluteDirectory, relativeDirectory = '') {
        const entries = readdirSync(absoluteDirectory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (ignoredRelativePaths.has(relativePath)) continue;
            const absolutePath = join(absoluteDirectory, entry.name);
            const stat = lstatSync(absolutePath);
            if (stat.isSymbolicLink()) throw new Error(`Snapshot contains a symbolic link: ${relativePath}`);
            if (stat.isDirectory()) {
                visit(absolutePath, relativePath);
                continue;
            }
            if (!stat.isFile()) throw new Error(`Snapshot contains an unsupported filesystem entry: ${relativePath}`);
            files.push({ absolutePath, relativePath });
        }
    }
    visit(root);

    return mapBounded(files, HASH_CONCURRENCY, async ({ absolutePath, relativePath }) => {
        // `before` is taken immediately around the read, as it always was, so the
        // changed-while-hashed check still brackets exactly the bytes it hashed.
        const before = lstatSync(absolutePath);
        const sha256 = await hashFile(absolutePath);
        const after = lstatSync(absolutePath);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
            throw new Error(`Snapshot file changed while it was hashed: ${relativePath}`);
        }
        return { path: relativePath, size: before.size, sha256 };
    });
}

function compareManifests(sourceManifest, targetManifest) {
    const source = new Map(sourceManifest.map((entry) => [entry.path, entry]));
    const target = new Map(targetManifest.map((entry) => [entry.path, entry]));
    for (const [path, expected] of source) {
        const actual = target.get(path);
        if (!actual) throw new Error(`Immutable snapshot is missing source file: ${path}`);
        if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
            throw new Error(`Immutable snapshot differs from source: ${path}`);
        }
    }
    for (const path of target.keys()) {
        if (!source.has(path)) throw new Error(`Immutable snapshot contains an unexpected file: ${path}`);
    }
}

function writeStatus(path, status) {
    writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

export async function prepareImmutableSnapshot({
    sourceRoot: requestedSourceRoot,
    targetRoot: requestedTargetRoot,
    copyFile = copyFileSync,
    now = () => new Date().toISOString(),
    pid = process.pid,
    log = logProgress,
}) {
    const source = resolve(requestedSourceRoot);
    const target = resolve(requestedTargetRoot);
    if (source === target || source.startsWith(`${target}\\`) || target.startsWith(`${source}\\`)) {
        throw new Error('Immutable snapshot source and target must be separate sibling directories.');
    }
    if (existsSync(target)) throw new Error(`Refusing to overwrite pre-existing immutable snapshot: ${target}`);
    if (!validateSnapshot(source)) {
        throw new Error('Build the client before running Playwright: dist is missing or incomplete.');
    }

    // Hash first. If the build moves while copying, the target comparison fails
    // and the evidence marker remains instead of ever starting the preview.
    const sourceManifest = await timedPhase(log, 'hashing source', () => buildSnapshotManifest(source));
    if (existsSync(target)) throw new Error(`Immutable snapshot target appeared while hashing source: ${target}`);

    mkdirSync(target);
    const statusPath = join(target, SNAPSHOT_STATUS_FILE);
    const startedAt = now();
    let stage = 'copy';
    writeStatus(statusPath, { schemaVersion: 1, status: 'copying', source, target, pid, startedAt, stage });

    try {
        await timedPhase(log, `copying ${sourceManifest.length} files`, () => copyTree(source, target, copyFile));
        stage = 'structure-validation';
        if (!validateSnapshot(target)) throw new Error('The Playwright preview snapshot is structurally incomplete.');
        stage = 'content-validation';
        const targetManifest = await timedPhase(log, 'verifying copy',
            () => buildSnapshotManifest(target, new Set([SNAPSHOT_STATUS_FILE])));
        compareManifests(sourceManifest, targetManifest);

        const totalBytes = sourceManifest.reduce((sum, entry) => sum + entry.size, 0);
        const manifestSha256 = createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex');
        const completedAt = now();
        const result = { fileCount: sourceManifest.length, totalBytes, manifestSha256 };
        writeStatus(statusPath, {
            schemaVersion: 1, status: 'ready', source, target, pid, startedAt, completedAt, ...result,
        });
        return result;
    } catch (error) {
        const failedAt = now();
        const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        try {
            writeStatus(statusPath, {
                schemaVersion: 1, status: 'incomplete', source, target, pid, startedAt, failedAt,
                failedStage: stage, error: description,
            });
        } catch (labelError) {
            throw new AggregateError([error, labelError], `Snapshot failed during ${stage}, and its evidence marker could not be updated.`);
        }
        throw error;
    }
}

async function main() {
    if (!/^\.playwright-dist-[a-z0-9_-]+$/i.test(requestedName)) {
        throw new Error(`Unsafe Playwright preview directory: ${requestedName}`);
    }
    // Announce the start. This step copies AND hash-verifies the whole build
    // (484 MB / 5,553 files on 2026-09-10, and growing), and because it runs inside
    // Playwright's `webServer` command, exceeding that timeout surfaces as a bare
    // "Timed out waiting ... from config.webServer" with no specs executed, which
    // reads like a catastrophic browser failure rather than a slow copy. Naming
    // the step — on stderr, see logProgress — means the log always shows what was
    // actually in progress.
    logProgress(`[e2e] Preparing immutable preview snapshot ${requestedName} from ${requestedSourceName}/ (copy + hash verify of the full build).`);
    const result = await prepareImmutableSnapshot({ sourceRoot, targetRoot });
    logProgress(`[e2e] Isolated preview snapshot ready: ${requestedName} (${result.fileCount} files, ${result.totalBytes} bytes, manifest ${result.manifestSha256})`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
