import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Exercise the production pg adapter over an isolated row store. This process
// never connects to a database and uses no production credentials.
process.env.DATABASE_URL = 'postgresql://expiry-test:expiry-test@127.0.0.1/expiry-test';
process.env.FORCE_PG_KV = '1';
delete process.env.VERCEL;
delete process.env.DISK_KV_DIR;
delete process.env.KV_PROXY_URL;
delete process.env.KV_PROXY_TOKEN;

type Row = { value: unknown; expires_at: string | null };
const rows = new Map<string, Row>();
const queryCounts = new Map<string, number>();
const originalQuery = pg.Pool.prototype.query;
const originalEnd = pg.Pool.prototype.end;
let storage: typeof import('./_storage.js');
let cleanupGate: Promise<void> | undefined;
let cleanupDone: Promise<void> | undefined;
let failCleanup = false;

before(async () => {
    pg.Pool.prototype.query = (async (sql: unknown, params: unknown[] = []) => {
        const query = String(sql).replace(/\s+/g, ' ').trim();
        const key = String(params[0] ?? '');
        queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
        if (query.startsWith('SELECT value, expires_at FROM public.kv_store')) {
            const row = rows.get(key);
            return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
        }
        if (query.startsWith('SELECT key, value')) {
            const selected = (params[0] as string[]).flatMap((item) => {
                const row = rows.get(item);
                return row && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())
                    ? [{ key: item, ...structuredClone(row) }] : [];
            });
            return { rows: selected, rowCount: selected.length };
        }
        if (query.startsWith('SELECT public.kv_set_nx')) {
            const existing = rows.get(key);
            if (existing && (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now())) {
                return { rows: [{ kv_set_nx: false }] };
            }
            rows.set(key, { value: JSON.parse(String(params[1])), expires_at: params[2] as string | null });
            return { rows: [{ kv_set_nx: true }] };
        }
        if (query.startsWith('INSERT INTO public.kv_store')) {
            rows.set(key, { value: JSON.parse(String(params[1])), expires_at: params[2] as string | null });
            return { rows: [{ swapped: true }], rowCount: 1 };
        }
        if (query.startsWith('UPDATE public.kv_store')) {
            rows.set(key, { value: JSON.parse(String(params[2])), expires_at: params[3] as string | null });
            return { rows: [{ swapped: true }], rowCount: 1 };
        }
        if (query.startsWith('DELETE FROM public.kv_store WHERE key = $1')) {
            const pending = (async () => {
                if (cleanupGate) await cleanupGate;
                if (failCleanup) throw new Error('isolated expired-row cleanup failure');
                const existing = rows.get(key);
                const expiryGuarded = query.includes('expires_at <= now()');
                const expired = !!existing?.expires_at && new Date(existing.expires_at).getTime() <= Date.now();
                const deleted = !!existing && (!expiryGuarded || expired);
                if (deleted) rows.delete(key);
                return { rows: [], rowCount: deleted ? 1 : 0 };
            })();
            cleanupDone = pending.then(() => undefined, () => undefined);
            return pending;
        }
        throw new Error(`Unexpected expiry-test query: ${query}`);
    }) as typeof pg.Pool.prototype.query;
    pg.Pool.prototype.end = (async () => undefined) as typeof pg.Pool.prototype.end;
    storage = await import('./_storage.js');
});

after(async () => {
    await storage?.closeStoragePool();
    pg.Pool.prototype.query = originalQuery;
    pg.Pool.prototype.end = originalEnd;
});

const CLOCK = 1_800_000_000_000;

test('expired-row cleanup cannot delete a concurrent live replacement', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
    const key = 'save:expired-cleanup-race';
    rows.set(key, { value: 'expired-owner', expires_at: new Date(CLOCK - 1).toISOString() });
    let releaseCleanup!: () => void;
    cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    try {
        assert.equal(await storage._pgKvForTest.get(key), null);
        await storage._pgKvForTest.set(key, 'replacement-owner', { ex: 60 });
        releaseCleanup();
        await cleanupDone;
        assert.equal(rows.get(key)?.value, 'replacement-owner', 'cleanup must recheck expiry while deleting');
    } finally {
        releaseCleanup();
        cleanupGate = undefined;
    }
});

for (const method of ['get', 'mget', 'set', 'set-nx', 'compareSet-null', 'compareSet-live'] as const) {
    test(`${method} cached data expires at its backing row TTL`, async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
        const key = `expiry-test:${method}`;
        const exp = new Date(CLOCK + 1000).toISOString();
        if (method === 'get' || method === 'mget') {
            rows.set(key, { value: 'short-lived', expires_at: exp });
            if (method === 'get') assert.equal(await storage._pgKvForTest.get(key), 'short-lived');
            else assert.deepEqual(await storage._pgKvForTest.mget(key), ['short-lived']);
        } else if (method === 'set' || method === 'set-nx') {
            assert.equal(await storage._pgKvForTest.set(key, 'short-lived', { ex: 1, nx: method === 'set-nx' }), 'OK');
        } else {
            const expected = method === 'compareSet-live' ? 'predecessor' : null;
            if (expected) rows.set(key, { value: expected, expires_at: null });
            assert.equal(await storage._pgKvForTest.compareSet(key, expected, 'short-lived', { ex: 1 }), true);
        }
        const reads = queryCounts.get(key) ?? 0;
        assert.equal(await storage._pgKvForTest.hgetall(key), 'short-lived', 'the live row should still use its cache');
        assert.equal(queryCounts.get(key), reads);
        t.mock.timers.setTime(CLOCK + 1000);
        assert.equal(await storage._pgKvForTest.get(key), null, 'expiry is inclusive and must bypass the cached value');
        assert.deepEqual(await storage._pgKvForTest.mget(key), [null]);
        await cleanupDone;
    });
}

test('a failed expired-row cleanup remains a handled best-effort operation', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: CLOCK });
    const key = 'save:expired-cleanup-error';
    rows.set(key, { value: 'expired', expires_at: new Date(CLOCK - 1).toISOString() });
    failCleanup = true;
    try {
        assert.equal(await storage._pgKvForTest.get(key), null);
        await cleanupDone;
        await new Promise<void>((resolve) => setImmediate(resolve));
        // node:test also fails the file if the cleanup promise is unhandled.
    } finally {
        failCleanup = false;
    }
});
