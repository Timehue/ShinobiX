import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
