import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const root = resolve(import.meta.dirname, '..');
// `shared` earns its place here: it holds the cross-cutting contracts both
// sides import (item-level-gate, tower-pvp, the hollow-gate/chronicle/pet
// showdown contracts). Its one test file sat invisible to this runner for its
// whole life — passing locally, never once executed by CI.
const scanRoots = ['api', 'scripts', 'shared', 'shinobij.client/src', 'shinobij.client/scripts'];
const files = ['cpanel-dns.test.cjs', 'server-routes.test.ts'];

function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) collect(absolute);
        else if (/\.test\.(?:tsx?|mjs|cjs)$/.test(entry.name)) files.push(relative(root, absolute).replaceAll('\\', '/'));
    }
}

for (const dir of scanRoots) collect(join(root, dir));
const uniqueFiles = [...new Set(files)].sort();

// Optional sharding for CI. The whole suite is a single ~17 minute step, which
// on a slow runner reached the job's 29 minute ceiling and was cancelled --
// reported as `0 failed, N cancelled` or simply a red job, on timing alone.
// TEST_SHARD_INDEX is 1-based. Files are dealt round-robin off the sorted list,
// so every file lands in exactly one shard, the split is stable across runs, and
// no shard inherits a whole directory's worth of slow neighbours. Unset (or a
// total of 1) runs everything, which is what a local `npm test` still does.
const shardTotal = Number.parseInt(process.env.TEST_SHARD_TOTAL ?? '', 10);
const shardIndex = Number.parseInt(process.env.TEST_SHARD_INDEX ?? '', 10);
const sharded = Number.isInteger(shardTotal) && shardTotal > 1;
if (sharded && (!Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > shardTotal)) {
    console.error(`✖ TEST_SHARD_INDEX must be 1..${shardTotal}; got ${process.env.TEST_SHARD_INDEX}`);
    process.exit(1);
}
const shardFiles = sharded
    ? uniqueFiles.filter((_file, position) => position % shardTotal === shardIndex - 1)
    : uniqueFiles;
if (sharded) {
    console.error(`[run-tests] shard ${shardIndex}/${shardTotal}: ${shardFiles.length} of ${uniqueFiles.length} files`);
    // A shard that matches nothing means the split is broken, not that there is
    // nothing to do. Fail loudly rather than reporting a green empty run.
    if (shardFiles.length === 0) {
        console.error('✖ TEST RUN FAILED — this shard matched no test files');
        process.exit(1);
    }
}
// The engine this repo targets is pinned in .nvmrc (mirrored by the Dockerfile
// and CI). A different local major is not an error, but it is the first thing
// to suspect when a file goes red at FILE level with every subtest green: that
// is how a native node.exe crash surfaces (see the exit-code logging below),
// and the 2026-09 investigation traced exactly that to Node 24.15.0 on Windows.
const pinnedMajor = (() => {
    try { return Number.parseInt(readFileSync(join(root, '.nvmrc'), 'utf8').trim(), 10); } catch { return NaN; }
})();
const runningMajor = Number.parseInt(process.versions.node, 10);
if (Number.isInteger(pinnedMajor) && runningMajor !== pinnedMajor) {
    console.error(`[run-tests] warning: running on Node ${process.versions.node}; .nvmrc pins ${pinnedMajor}. ` +
        'A file-level failure with every subtest passing is usually a child-process crash, not a test bug.');
}

const tests = run({ cwd: root, files: shardFiles, concurrency: true });

// Do NOT rely on `test:fail` alone to decide the exit code. It misses failure
// modes that never surface as a discrete failing test — a worker that crashes,
// a run that is cancelled, a file that never produces its tests. The authoritative
// signal is the FINAL `test:summary` event (the one with no `file`): its `success`
// flag and aggregate counts reflect every failure the runner observed. We treat a
// run as failed unless that summary arrived and reported success. (`test:fail` and
// stream `error` are kept as belt-and-suspenders so we fail loudly even if a future
// Node changes when the summary is emitted.)
let failEvents = 0;
let finalSummary = null;
let streamError = null;

tests.on('test:fail', (event) => {
    failEvents++;
    // node:test marks a FILE failed when its child process exits non-zero, and the
    // spec reporter prints only the bare 'test failed' for it -- the exit code and
    // signal live on the error object and are otherwise dropped. Print them, so a
    // child that died natively (all subtests green, no stack, no stderr) is
    // recognisable as such. Windows reports a native fault as an NTSTATUS in the
    // 0xC0000000 range, e.g. 0xC0000409 (libuv fatal abort), 0xC0000374 (heap
    // corruption), 0xC0000005 (access violation).
    const error = event?.details?.error;
    const exitCode = error?.exitCode;
    const signal = error?.signal;
    if (event?.nesting === 0 && (exitCode != null || signal != null)) {
        const hex = typeof exitCode === 'number' ? ` (0x${(exitCode >>> 0).toString(16).toUpperCase().padStart(8, '0')})` : '';
        console.error(`\n✖ ${event.file ?? event.name}: child process exited with code ${exitCode}${hex}` +
            (signal ? ` signal ${signal}` : '') +
            ' -- if every subtest above it passed, the process crashed after (or outside) the tests.');
    }
});
tests.on('test:summary', (summary) => {
    // Per-file summaries carry a `file`; the single run-wide summary does not.
    if (!summary.file) finalSummary = summary;
});
tests.on('error', (err) => { streamError = err; });

tests.compose(spec()).pipe(process.stdout);

process.on('exit', (code) => {
    // Respect an already-failing exit code (e.g. an uncaught exception that set it).
    if (code !== 0) return;

    const counts = finalSummary?.counts;
    const failed =
        streamError != null ||
        finalSummary == null ||          // run never produced a final summary → treat as broken
        finalSummary.success === false ||
        failEvents > 0 ||
        (counts != null && (counts.failed > 0 || counts.cancelled > 0)) ||
        (counts != null && counts.tests === 0); // discovered files but ran zero tests → broken

    // A single, greppable banner so a real failure is never mistaken for a pass.
    if (failed) {
        const detail = streamError
            ? `stream error: ${streamError.message}`
            : finalSummary == null
                ? 'no final test summary was emitted (the run did not complete)'
                : counts
                    ? `${counts.failed} failed, ${counts.cancelled} cancelled, ${counts.passed} passed of ${counts.tests} tests`
                    : `${failEvents} failing test event(s)`;
        console.error(`\n✖ TEST RUN FAILED — ${detail}`);
        process.exitCode = 1;
    } else {
        console.error(`\n✔ TEST RUN PASSED — ${counts.passed} passed of ${counts.tests} tests`);
    }
});
