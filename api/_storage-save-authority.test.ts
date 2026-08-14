import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { matchesStoredSaveVersion } from './save/_save-version.js';

process.env.DATABASE_URL = 'postgresql://cache-test:cache-test@127.0.0.1/cache-test';
process.env.FORCE_PG_KV = '1';
delete process.env.VERCEL;
delete process.env.DISK_KV_DIR;
delete process.env.KV_PROXY_URL;
delete process.env.KV_PROXY_TOKEN;

type StorageModule = typeof import('./_storage.js');
type SaveRecord = { _saveVersion: number; character: Record<string, unknown> };

const database = new Map<string, unknown>();
const selectCount = new Map<string, number>();
const originalQuery = pg.Pool.prototype.query;
const originalEnd = pg.Pool.prototype.end;
let workerA: StorageModule;
let workerB: StorageModule;

before(async () => {
    // Both storage module instances below construct their own Pool and their own
    // process-local read cache. This query shim is the one shared Postgres row
    // store those independent "processes" communicate through.
    pg.Pool.prototype.query = (async (sql: unknown, params?: unknown[]) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        const key = String(params?.[0] ?? '');
        if (text.startsWith('SELECT value, expires_at FROM public.kv_store')) {
            selectCount.set(key, (selectCount.get(key) ?? 0) + 1);
            return {
                rows: database.has(key)
                    ? [{ value: structuredClone(database.get(key)), expires_at: null }]
                    : [],
                rowCount: database.has(key) ? 1 : 0,
            };
        }
        if (text.startsWith('SELECT key, value FROM public.kv_store')) {
            const keys = (params?.[0] as string[] | undefined) ?? [];
            for (const item of keys) selectCount.set(item, (selectCount.get(item) ?? 0) + 1);
            const rows = keys
                .filter((item) => database.has(item))
                .map((item) => ({ key: item, value: structuredClone(database.get(item)) }));
            return { rows, rowCount: rows.length };
        }
        if (text.startsWith('INSERT INTO public.kv_store')) {
            database.set(key, JSON.parse(String(params?.[1] ?? 'null')));
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected pgKv query in cache authority test: ${text}`);
    }) as typeof pg.Pool.prototype.query;
    pg.Pool.prototype.end = (async () => undefined) as typeof pg.Pool.prototype.end;

    const storageUrl = pathToFileURL(join(process.cwd(), 'api', '_storage.ts')).href;
    const nonce = `${Date.now()}-${Math.random()}`;
    workerA = await import(`${storageUrl}?cache-worker=a-${nonce}`) as StorageModule;
    workerB = await import(`${storageUrl}?cache-worker=b-${nonce}`) as StorageModule;
});

after(async () => {
    await Promise.all([
        workerA?.closeStoragePool(),
        workerB?.closeStoragePool(),
    ]);
    pg.Pool.prototype.query = originalQuery;
    pg.Pool.prototype.end = originalEnd;
});

async function exactVersionWrite(
    storage: StorageModule,
    key: string,
    baseVersion: number,
    next: SaveRecord,
): Promise<boolean> {
    const current = await storage._pgKvForTest.get<SaveRecord>(key);
    if (!current || !matchesStoredSaveVersion(baseVersion, current._saveVersion)) return false;
    await storage._pgKvForTest.set(key, next);
    return true;
}

test('independent pgKv process caches cannot admit a stale save guard or overwrite a newer save', async () => {
    const saveKey = 'save:cache-race';
    const v5: SaveRecord = { _saveVersion: 5, character: { marker: 'client-v5' } };
    const v6: SaveRecord = { _saveVersion: 6, character: { marker: 'server-v6', serverCredit: 500 } };

    await workerA._pgKvForTest.set(saveKey, v5);
    assert.deepEqual(await workerA._pgKvForTest.get(saveKey), v5, 'worker A primes its read path at v5');
    await workerB._pgKvForTest.set(saveKey, v6);

    const staleAccepted = await exactVersionWrite(workerA, saveKey, 5, {
        _saveVersion: 6,
        character: { marker: 'stale-autosave' },
    });

    assert.equal(staleAccepted, false, 'worker A must observe v6 and reject base v5');
    assert.deepEqual(database.get(saveKey), v6, 'the newer server credit must survive');
    assert.ok(
        (selectCount.get(saveKey) ?? 0) >= 2,
        'save reads must hit Postgres again instead of reusing worker A\'s v5 cache',
    );
});

test('batched pgKv save reads are authoritative across processes too', async () => {
    const key = 'save:batch-cache-race';
    const v8: SaveRecord = { _saveVersion: 8, character: { marker: 'batch-v8' } };
    const v9: SaveRecord = { _saveVersion: 9, character: { marker: 'batch-v9' } };

    await workerA._pgKvForTest.set(key, v8);
    assert.deepEqual(await workerA._pgKvForTest.mget(key), [v8]);
    await workerB._pgKvForTest.set(key, v9);

    assert.deepEqual(
        await workerA._pgKvForTest.mget(key),
        [v9],
        'mget must not reuse a process-local save snapshot after another writer commits',
    );
});

test('Chronicle settlement and all Legacy RMW keys bypass independent process caches', async () => {
    const authorityKeys = [
        'card-clash:queue',
        'cc-pair:cache-race',
        'cc-freeplay:cache-race',
        'cc-ai:cache-race',
        'cc-freeplay-legacy-pair:alpha:bravo',
        'legacy:stats:alpha',
        'legacy:events:alpha',
        'legacy:suspects',
        'legacy:trial:alpha',
        'legacy:trial-effects-done:alpha:receipt-1',
        'legacy:accept-effects-done:alpha:receipt-1',
        'legacy:accepted:alpha',
        'legacy:sage-offer:alpha',
    ];

    for (const key of authorityKeys) {
        await workerA._pgKvForTest.set(key, { revision: 1 });
        assert.deepEqual(await workerA._pgKvForTest.get(key), { revision: 1 });
        const readsBeforeRemoteWrite = selectCount.get(key) ?? 0;
        await workerB._pgKvForTest.set(key, { revision: 2 });

        assert.deepEqual(
            await workerA._pgKvForTest.get(key),
            { revision: 2 },
            `${key} must observe the other process's authoritative write`,
        );
        assert.ok(
            (selectCount.get(key) ?? 0) > readsBeforeRemoteWrite,
            `${key} must re-read Postgres instead of serving its local snapshot`,
        );
    }
});

test('Legacy world-history outboxes cannot lose another worker\'s RMW update', async () => {
    const authorityKeys = [
        'audit:legacy',
        'hall:entries',
        'hall:nx:server-first:legacy-summit',
        'game:announcements',
        'game:era-state',
        'era:effects-done:age-of-echoes',
        'era:trigger:age-of-echoes',
        'chat:village:stormveil-village',
    ];

    for (const key of authorityKeys) {
        await workerA._pgKvForTest.set(key, { revision: 1 });
        assert.deepEqual(await workerA._pgKvForTest.get(key), { revision: 1 });
        const readsBeforeRemoteEffect = selectCount.get(key) ?? 0;
        await workerB._pgKvForTest.set(key, { revision: 2 });

        assert.deepEqual(
            await workerA._pgKvForTest.get(key),
            { revision: 2 },
            `${key} must observe the other process's durable world effect`,
        );
        assert.ok(
            (selectCount.get(key) ?? 0) > readsBeforeRemoteEffect,
            `${key} must re-read Postgres instead of overwriting shared history`,
        );
    }
});

test('solo-PvE versions, story bindings, and permanent choices stay authoritative across workers', async () => {
    const authorityKeys = [
        'solo-pve:story-cache-race',
        'story-combat-binding:story-cache-race',
        'story:cache-race-player',
    ];

    for (const key of authorityKeys) {
        await workerA._pgKvForTest.set(key, { version: 1, evidence: ['first'] });
        assert.deepEqual(
            await workerA._pgKvForTest.get(key),
            { version: 1, evidence: ['first'] },
            `${key} primes worker A's independent read path`,
        );
        const readsBeforeRemoteMove = selectCount.get(key) ?? 0;
        await workerB._pgKvForTest.set(key, { version: 2, evidence: ['first', 'remote-move'] });

        assert.deepEqual(
            await workerA._pgKvForTest.get(key),
            { version: 2, evidence: ['first', 'remote-move'] },
            `${key} must not admit worker A's stale version after worker B commits`,
        );
        assert.ok(
            (selectCount.get(key) ?? 0) > readsBeforeRemoteMove,
            `${key} must re-read Postgres instead of serving process-local authority`,
        );
    }
});

test('pet, PvP, and war proofs, results, queues, and shared sessions stay authoritative across workers', async () => {
    const authorityKeys = [
        'pet:battle-active:alpha',
        'pet:battle-token:alpha:cache-race',
        'pet:warfront-initializing:alpha',
        'pet:ranked-token:cache-race',
        'pet:ranked-result:cache-race',
        'pet:ranked-intent:cache-race',
        'pet:ranked-start-claim:cache-race',
        'pet:ranked-active',
        'pvp:pet-ranked-queue',
        'pvp:pet-ranked-queue:match:alpha',
        'pvp:cache-race-battle',
        'pvp:cache-race-battle:lock',
        'pvp:bounty-claimed:cache-race-battle',
        'world:territory:18',
        'raid-territory-proof:cache-race-proof',
        'world:war:storm-vs-leaf',
        'clan-war:storm-vs-leaf',
        'clan-war-xp:war-1:storm',
        'arena:lobby:CACHE1',
        'sector-pet:cache-race',
        'hg-pet-result:alpha:cache-race',
        'petgauntlet:tok:cache-race',
        'petgauntlet:lb:2026-W33',
        'petladder:coliseum',
        'petladder:coliseum:def:alpha',
        'clan-war-pet:war-1:challenge-1',
        'pet-sanctuary:alpha:meta',
        'pet-breeding-result:alpha:breed-1',
        'pet-encounter:alpha:cache-race',
        'pet-encounter-attempt:alpha:2026-08-11',
    ];

    for (const key of authorityKeys) {
        await workerA._pgKvForTest.set(key, { revision: 1 });
        assert.deepEqual(await workerA._pgKvForTest.get(key), { revision: 1 });
        const readsBeforeRemoteSettlement = selectCount.get(key) ?? 0;
        await workerB._pgKvForTest.set(key, { revision: 2 });

        assert.deepEqual(
            await workerA._pgKvForTest.get(key),
            { revision: 2 },
            `${key} must observe the other process's authoritative settlement`,
        );
        assert.ok(
            (selectCount.get(key) ?? 0) > readsBeforeRemoteSettlement,
            `${key} must re-read Postgres instead of serving process-local battle authority`,
        );
    }
});

test('the no-cache scope stays narrow: safe game and snapshot keys retain pgKv caching', async () => {
    for (const key of ['game:cache-probe', 'save-snapshot:cache-race:123']) {
        await workerA._pgKvForTest.set(key, { revision: 1 });
        assert.deepEqual(await workerA._pgKvForTest.get(key), { revision: 1 });
        await workerB._pgKvForTest.set(key, { revision: 2 });

        assert.deepEqual(
            await workerA._pgKvForTest.get(key),
            { revision: 1 },
            'safe/eventually-consistent prefixes should keep their process-local cache',
        );
        assert.equal(selectCount.get(key) ?? 0, 0, 'worker A should serve this safe key from cache');
    }
});
