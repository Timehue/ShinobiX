import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { KvLike } from '../api/_storage.js';
import { projectKvValue, readKvProjection } from '../api/_storage-projection.js';
import { ADMIN_PLAYER_SAVE_PROJECTION, PUBLIC_INDEX_SAVE_PROJECTION, readPublicIndexCharacters } from '../api/player/_list-save-projections.js';

/** Called only by the guarded disposable-Postgres suite. No application credentials or player data. */
export async function benchmarkListSaveReads(store: KvLike, seed: (key: string, value: unknown) => Promise<void>) {
    const players = 64, requests = 12, blobBytes = 65_536;
    const blob = Array.from({ length: blobBytes / 64 }, (_, i) => createHash('sha256').update(`fixture:${i}`).digest('hex')).join('');
    const fixtures = Array.from({ length: players }, (_, i) => ({
        _saveVersion: 3, character: { name: `Fixture${i}`, level: 20 + i, village: 'Stormveil', specialty: 'Ninjutsu',
            rankedRating: 1200 + i, ranked2v2Rating: 1100 + i, stats: { strength: 15 + i }, unspentStats: i,
            inventory: [`fixture-item-${i}`], ryo: 1000 },
        savedBloodlines: [{ id: `fixture-bloodline-${i}`, name: 'Fixture bloodline', rank: 'B Rank', jutsus: [{ id: 'fixture-jutsu' }] }],
        unrelatedSaveContent: blob,
    }));
    // Separate keys per request make every baseline call a real database read,
    // even though pgit: test keys (unlike production save: keys) are cacheable.
    const groups = Array.from({ length: requests }, (_, n) => fixtures.map((_, i) => `pgit:read-benchmark:${n}:${i}`));
    for (const keys of groups) for (let i = 0; i < keys.length; i++) await seed(keys[i]!, fixtures[i]);

    const originalQuery = pg.Pool.prototype.query;
    const originalConnect = pg.Pool.prototype.connect;
    let pool: pg.Pool | undefined;
    let active = false, calls = 0, queued = 0, waitMs = 0, peakWaiting = 0;
    pg.Pool.prototype.query = function (this: pg.Pool, ...args: unknown[]) {
        pool = this;
        if (active) calls++;
        const result = Reflect.apply(originalQuery, this, args);
        if (active) peakWaiting = Math.max(peakWaiting, this.waitingCount);
        return result;
    } as typeof originalQuery;
    pg.Pool.prototype.connect = function (this: pg.Pool, ...args: unknown[]) {
        const started = performance.now();
        // pg schedules idle-client handoffs on the next tick. Pending handoffs
        // already consume those idle clients even before idleCount decreases.
        const mustQueue = active && this.waitingCount >= this.idleCount && this.totalCount >= (this.options.max ?? 10);
        const acquired = () => { if (mustQueue) { queued++; waitMs += performance.now() - started; } };
        const callback = args[0];
        if (typeof callback === 'function') {
            args[0] = (...result: unknown[]) => { acquired(); return Reflect.apply(callback, undefined, result); };
            return Reflect.apply(originalConnect, this, args);
        }
        return (Reflect.apply(originalConnect, this, args) as Promise<pg.PoolClient>).then(client => { acquired(); return client; });
    } as typeof originalConnect;

    // Socket counters measure actual received PostgreSQL protocol bytes, not
    // JSON.stringify estimates. Connections are warmed before either variant.
    const receivedBytes = () => {
        const clients = (pool as unknown as { _clients: Array<{ connection: { stream: { bytesRead: number } } }> })._clients;
        return clients.reduce((total, client) => total + client.connection.stream.bytesRead, 0);
    };
    const measure = async (run: (keys: string[]) => Promise<unknown[]>, check: (values: unknown[]) => void) => {
        calls = 0; queued = 0; waitMs = 0; peakWaiting = 0;
        const bytesBefore = receivedBytes();
        const latencies: number[] = [];
        active = true;
        try {
            await Promise.all(groups.map(async keys => {
                const start = performance.now();
                const result = await run(keys);
                latencies.push(performance.now() - start);
                check(result);
            }));
        } finally { active = false; }
        latencies.sort((a, b) => a - b);
        assert.equal(calls, requests, 'one database call per list, without baseline cache hits or projection fallbacks');
        return { calls, receivedBytes: receivedBytes() - bytesBefore,
            medianMs: +latencies[Math.floor(latencies.length / 2)]!.toFixed(2), p95Ms: +latencies[Math.ceil(latencies.length * .95) - 1]!.toFixed(2),
            queuedAcquisitions: queued, poolWaitMs: +waitMs.toFixed(2), peakPendingAcquisitions: peakWaiting };
    };
    try {
        await store.mgetProjected!(groups[0]!, {});
        await Promise.all(Array.from({ length: pool!.options.max ?? 10 }, () => store.mgetProjected!(groups[0]!, {})));
        const adminExpected = fixtures.map(value => projectKvValue(value, ADMIN_PLAYER_SAVE_PROJECTION));
        const indexExpected = fixtures.map(value => projectKvValue(value, PUBLIC_INDEX_SAVE_PROJECTION));
        const baseline = await measure(keys => store.mget(...keys), values => {
            assert.deepEqual(values.map(value => projectKvValue(value, ADMIN_PLAYER_SAVE_PROJECTION)), adminExpected);
            assert.deepEqual(values.map(value => projectKvValue(value, PUBLIC_INDEX_SAVE_PROJECTION)), indexExpected);
        });
        const adminProjection = await measure(keys => readKvProjection(store, keys, ADMIN_PLAYER_SAVE_PROJECTION), values => assert.deepEqual(values, adminExpected));
        const leaderboardProjection = await measure(keys => readPublicIndexCharacters(store, keys), values => assert.deepEqual(values, indexExpected));
        assert.ok(adminProjection.receivedBytes < baseline.receivedBytes / 10);
        assert.ok(leaderboardProjection.receivedBytes < baseline.receivedBytes / 10);
        // Timings are reported, never asserted: host scheduling is not a product invariant.
        return { fixture: { playersPerList: players, concurrentRequests: requests, unrelatedBytesPerSave: blobBytes, poolMax: pool!.options.max },
            baseline, adminProjection, leaderboardProjection };
    } finally {
        pg.Pool.prototype.query = originalQuery;
        pg.Pool.prototype.connect = originalConnect;
    }
}
