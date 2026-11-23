process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { kv } from '../_storage.js';
import { SNAPSHOT_SUCCESS_KEY, type SnapshotSuccessMarker } from './snapshot-saves.js';
import { runBootSnapshotCatchUpCore, stopSnapshotCron } from './_scheduler.js';

// The boot catch-up reads the backup-freshness marker first. On 2026-11-23 a
// deploy's container swap refused that one read (EMAXCONNSESSION), and the
// scheduler treated "unknown" as "stale": it ran a full snapshot pass of every
// save against the already-full pool, 22 h after the nightly backup.

const POOL_FULL = () => Object.assign(
    new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 25'),
    { code: 'EMAXCONNSESSION' },
);

beforeEach(async () => { for (const key of await kv.keys('*')) await kv.del(key); });
after(() => stopSnapshotCron());

function capture(t: import('node:test').TestContext) {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
        t.mock.method(console, level, (...args: unknown[]) => { lines.push(`${level} ${args.map(String).join(' ')}`); });
    }
    return lines;
}

function failMarkerRead(t: import('node:test').TestContext, error: () => Error) {
    const get = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
        if (args[0] === SNAPSHOT_SUCCESS_KEY) throw error();
        return get(...args);
    });
}

test('a pool-full refusal of the marker read defers the check instead of running a full snapshot pass', async (t) => {
    const lines = capture(t);
    failMarkerRead(t, POOL_FULL);
    const keys = t.mock.method(kv, 'keys');
    await runBootSnapshotCatchUpCore();
    assert.ok(lines.some((line) => line.startsWith('warn') && line.includes('backup marker read deferred')), lines.join('\n'));
    assert.ok(!lines.some((line) => line.includes('boot catch-up:')), 'no snapshot pass ran');
    assert.ok(!lines.some((line) => line.startsWith('error')), 'a transient refusal is not logged as an error');
    assert.equal(keys.mock.callCount(), 0, 'the save keyspace was never scanned');
    assert.equal(await kv.get('cron:lease:snapshot'), null, 'the nightly snapshot lease was not taken');
});

test('a permanent marker-read failure still runs the catch-up, as before', async (t) => {
    const lines = capture(t);
    failMarkerRead(t, () => Object.assign(new Error('password authentication failed for user'), { code: '28P01' }));
    await runBootSnapshotCatchUpCore();
    assert.ok(lines.some((line) => line.startsWith('error') && line.includes('attempting boot catch-up')), lines.join('\n'));
    assert.ok(lines.some((line) => line.includes('boot catch-up:') || line.includes('snapshot recovery deferred')), 'the catch-up was attempted');
});

test('a fresh marker still short-circuits the catch-up', async (t) => {
    const lines = capture(t);
    const marker: SnapshotSuccessMarker = { completedAt: Date.now() - 22 * 60 * 60 * 1000, snapshotted: 14, skipped: 259, total: 273, elapsedMs: 14_646 };
    await kv.set(SNAPSHOT_SUCCESS_KEY, marker);
    const keys = t.mock.method(kv, 'keys');
    await runBootSnapshotCatchUpCore();
    assert.ok(lines.some((line) => line.includes('backup freshness ok')), lines.join('\n'));
    assert.ok(!lines.some((line) => line.includes('boot catch-up:')), 'no snapshot pass ran');
    assert.equal(keys.mock.callCount(), 0);
});
