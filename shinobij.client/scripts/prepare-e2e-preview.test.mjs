import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { buildSnapshotManifest, prepareImmutableSnapshot, SNAPSHOT_STATUS_FILE } from './prepare-e2e-preview.mjs';

function workspace(t) {
    const root = mkdtempSync(join(tmpdir(), 'shinobix-e2e-preview-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'dist');
    const target = join(root, '.playwright-dist-test');
    mkdirSync(join(source, 'assets'), { recursive: true });
    mkdirSync(join(source, 'nested'), { recursive: true });
    writeFileSync(join(source, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
    writeFileSync(join(source, 'assets', 'app.js'), 'console.log("frozen");');
    writeFileSync(join(source, 'nested', 'evidence.bin'), Buffer.from([0, 1, 2, 3, 255]));
    return { root, source, target };
}

test('publishes a fresh snapshot only after every source byte matches', async (t) => {
    const { source, target } = workspace(t);
    const result = await prepareImmutableSnapshot({ sourceRoot: source, targetRoot: target, now: () => '2026-08-12T17:00:00.000Z', pid: 42 });

    assert.equal(result.fileCount, 3);
    assert.deepEqual(
        await buildSnapshotManifest(target, new Set([SNAPSHOT_STATUS_FILE])),
        await buildSnapshotManifest(source),
    );
    const status = JSON.parse(readFileSync(join(target, SNAPSHOT_STATUS_FILE), 'utf8'));
    assert.equal(status.status, 'ready');
    assert.equal(status.fileCount, 3);
    assert.equal(status.manifestSha256, result.manifestSha256);
});

test('refuses a pre-existing final path without changing it', async (t) => {
    const { source, target } = workspace(t);
    mkdirSync(target);
    const sentinel = join(target, 'keep-me.txt');
    writeFileSync(sentinel, 'original');

    await assert.rejects(
        prepareImmutableSnapshot({ sourceRoot: source, targetRoot: target }),
        /Refusing to overwrite pre-existing immutable snapshot/,
    );
    assert.equal(readFileSync(sentinel, 'utf8'), 'original');
    assert.equal(existsSync(join(target, SNAPSHOT_STATUS_FILE)), false);
});

test('retains and labels an incomplete direct copy when copying fails', async (t) => {
    const { source, target } = workspace(t);
    const failingCopy = (from, to, flags) => {
        if (basename(from) === 'evidence.bin') throw new Error('injected copy failure');
        copyFileSync(from, to, flags);
    };

    await assert.rejects(
        prepareImmutableSnapshot({ sourceRoot: source, targetRoot: target, copyFile: failingCopy }),
        /injected copy failure/,
    );
    assert.equal(existsSync(target), true);
    const status = JSON.parse(readFileSync(join(target, SNAPSHOT_STATUS_FILE), 'utf8'));
    assert.equal(status.status, 'incomplete');
    assert.equal(status.failedStage, 'copy');
    assert.match(status.error, /injected copy failure/);
});

// Hashing runs 16-wide. If results were collected in COMPLETION order the manifest
// — and the manifestSha256 recorded from it — would change from run to run. Large
// files are placed EARLY in sort order and tiny ones late, so the tiny ones finish
// first; only an input-ordered result survives that.
test('concurrent hashing keeps the depth-first, locale-sorted manifest order', async (t) => {
    const { source, target } = workspace(t);
    for (const directory of ['a-big', 'b-mixed', 'b-mixed/deep', 'c-tiny']) mkdirSync(join(source, directory), { recursive: true });
    for (let index = 0; index < 12; index += 1) writeFileSync(join(source, 'a-big', `chunk-${index}.bin`), Buffer.alloc(256 * 1024, index));
    for (const name of ['f1', 'f10', 'f2', 'F3', 'g']) writeFileSync(join(source, 'b-mixed', name), name);
    for (const name of ['z', 'm', 'a']) writeFileSync(join(source, 'b-mixed', 'deep', name), name);
    for (let index = 0; index < 40; index += 1) writeFileSync(join(source, 'c-tiny', `t-${String(index).padStart(2, '0')}`), String(index));

    // The expected order is computed here with a plain sequential walk, so the
    // test does not trust the code under test to define "correct".
    const expected = [];
    (function walk(directory, prefix) {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((l, r) => l.name.localeCompare(r.name))) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(join(directory, entry.name), relative);
            else expected.push(relative);
        }
    })(source, '');

    assert.deepEqual((await buildSnapshotManifest(source)).map((entry) => entry.path), expected);
    const result = await prepareImmutableSnapshot({ sourceRoot: source, targetRoot: target, log: () => {} });
    assert.equal(result.fileCount, expected.length);
    assert.equal(JSON.parse(readFileSync(join(target, SNAPSHOT_STATUS_FILE), 'utf8')).status, 'ready');
});

// A snapshot that overruns Playwright's webServer timeout dies with only "Timed out
// waiting ... from config.webServer". The phase lines are what turn that into a
// diagnosis: the last one printed names the step that was still running.
test('announces each phase so a stalled snapshot names the step it is stuck in', async (t) => {
    const { source, target } = workspace(t);
    const lines = [];
    await prepareImmutableSnapshot({ sourceRoot: source, targetRoot: target, log: (line) => lines.push(line) });
    assert.deepEqual(
        lines.map((line) => line.replace(/^\[e2e\] snapshot: /, '').replace(/ done in \d+\.\ds$/, ' done')),
        [
            'hashing source…', 'hashing source done',
            'copying 3 files…', 'copying 3 files done',
            'verifying copy…', 'verifying copy done',
        ],
    );
});

// Playwright's webServer IGNORES a command's stdout by default, and none of our
// configs override it. Progress printed there is silently discarded — which is how
// this script's "announce the phase" safeguard went unseen in every CI log.
test('reports progress on stderr, because Playwright discards webServer stdout', () => {
    const script = readFileSync(new URL('./prepare-e2e-preview.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(script, /\bconsole\.(log|info)\s*\(/, 'console.log/info writes to stdout, which Playwright discards');
    assert.doesNotMatch(script, /\bprocess\.stdout\b/, 'stdout is discarded by Playwright; write progress to stderr');
});

test('detects byte corruption and never labels the snapshot ready', async (t) => {
    const { source, target } = workspace(t);
    const corruptingCopy = (from, to, flags) => {
        copyFileSync(from, to, flags);
        if (basename(from) === 'evidence.bin') writeFileSync(to, Buffer.from([9, 9, 9]));
    };

    await assert.rejects(
        prepareImmutableSnapshot({ sourceRoot: source, targetRoot: target, copyFile: corruptingCopy }),
        /Immutable snapshot differs from source/,
    );
    const status = JSON.parse(readFileSync(join(target, SNAPSHOT_STATUS_FILE), 'utf8'));
    assert.equal(status.status, 'incomplete');
    assert.equal(status.failedStage, 'content-validation');
});
