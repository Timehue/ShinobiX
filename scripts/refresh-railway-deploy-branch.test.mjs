import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const script = readFileSync(new URL('./refresh-railway-deploy-branch.sh', import.meta.url), 'utf8');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

test('lean deployment publishes the same source tree without fetching promised blobs', (t) => {
    publishLean(t, { mainMovedOn: false });
});

// A manual run for an older commit: no ref the server advertises points at it,
// so without push negotiation git packs the whole tree and lazy-fetches every
// blob (the 2026-11-17 hang that timed out both workflow_dispatch runs).
test('a manual run for an older commit publishes without fetching promised blobs', (t) => {
    publishLean(t, { mainMovedOn: true });
});

function publishLean(t, { mainMovedOn }) {
    const root = mkdtempSync(join(tmpdir(), 'shinobix-lean-deploy-'));
    t.after(() => {
        assert.equal(dirname(resolve(root)), resolve(tmpdir()));
        assert.ok(root.includes('shinobix-lean-deploy-'));
        rmSync(root, { recursive: true, force: true });
    });
    const git = (cwd, ...args) => execFileSync('git', args, {
        cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    }).trim();
    const seed = join(root, 'seed');
    const origin = join(root, 'origin.git');
    const partial = join(root, 'partial');
    mkdirSync(seed);
    git(seed, 'init', '--initial-branch=main');
    git(seed, 'config', 'user.name', 'Deployment regression fixture');
    git(seed, 'config', 'user.email', 'fixture@example.invalid');
    const kept = [
        'Dockerfile', 'railway.json', 'package.json', 'server.ts', 'api/example.ts',
        'shinobij.client/src/main.ts', '.github/workflows/ci.yml',
        'shinobij.client/art-source/pet-portrait-refresh/production.json',
        'shinobij.client/art-source/hollow-gate-cavern-chambers.json',
    ];
    const dropped = [
        'docs/evidence.txt', 'release-audit/evidence.txt', 'mobile/source.txt',
        'android/source.txt', 'shinobij.client/art-source/raw.txt',
        'shinobij.client/art-references/raw.txt', '.ci-evidence/log.txt',
        'output/raw.txt', 'outputs/raw.txt', 'shinobij.client/dist-perf/build.txt',
        'shinobij.client/.playwright-dist-fixture/build.txt',
    ];
    for (const path of [...kept, ...dropped]) {
        mkdirSync(dirname(join(seed, path)), { recursive: true });
        writeFileSync(join(seed, path), `fixture ${path}\n`);
    }
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'Deployment fixture source');
    const source = git(seed, 'rev-parse', 'HEAD');
    if (mainMovedOn) {
        writeFileSync(join(seed, 'api/later.ts'), 'fixture later\n');
        git(seed, 'add', '.');
        git(seed, 'commit', '-m', 'A later main commit');
    }
    git(root, 'clone', '--bare', seed, origin);
    git(origin, 'config', 'uploadpack.allowFilter', 'true');
    git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    // The workflow's checkout: blob-less, depth 1, at the source commit (no files
    // checked out, which would hydrate them).
    mkdirSync(partial);
    git(partial, 'init');
    git(partial, 'remote', 'add', 'origin', `file://${origin.replaceAll('\\', '/')}`);
    git(partial, 'fetch', '--no-tags', '--depth=1', '--filter=blob:none', 'origin', source);
    git(partial, 'config', 'user.name', 'Deployment regression fixture');
    git(partial, 'config', 'user.email', 'fixture@example.invalid');
    assert.equal(git(partial, 'config', '--get', 'remote.origin.promisor'), 'true');
    assert.match(git(partial, 'rev-list', '--objects', '--missing=print', source), /^\?/m,
        'the fixture must actually start with missing promised blobs');

    const executable = join(root, 'refresh.sh');
    const trace = join(root, 'trace.jsonl');
    writeFileSync(executable, script.replace(/\r\n/g, '\n'));
    const output = execFileSync(bash, [executable.replaceAll('\\', '/'), source, 'railway-deploy'], {
        cwd: partial, encoding: 'utf8', windowsHide: true, timeout: 30000,
        env: { ...process.env, GIT_TRACE2_EVENT: trace.replaceAll('\\', '/'),
            GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    });
    const published = git(origin, 'rev-parse', 'refs/heads/railway-deploy');
    assert.match(output, new RegExp(`commit=${published} source=${source}`));
    assert.equal(git(origin, 'rev-parse', `${published}^`), source);
    assert.deepEqual(git(origin, 'ls-tree', '-r', '--name-only', published).split('\n').sort(), kept.sort());
    for (const path of kept) {
        assert.equal(git(origin, 'rev-parse', `${published}:${path}`), git(origin, 'rev-parse', `${source}:${path}`),
            `${path} must retain the exact source object`);
    }
    const fetches = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line))
        // The push's negotiation round trip downloads no objects; anything else is a blob fetch.
        .filter(event => event.event === 'child_start' && event.argv?.includes('fetch')
            && !event.argv.includes('--negotiate-only'));
    assert.equal(fetches.length, 0,
        `publishing a tree must not hydrate promised blobs: ${JSON.stringify(fetches.map(event => event.argv))}`);
    assert.match(git(partial, 'rev-list', '--objects', '--missing=print', source), /^\?/m,
        'publishing must leave the source blobs unhydrated');
}
