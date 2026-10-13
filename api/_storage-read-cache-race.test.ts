import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';

/*
 * The pg store's process read cache when a read and a write of the same key
 * overlap (api/_storage.ts, "Fill generations"). A read caches what it
 * SELECTed only once its query returns, so without a guard a read that saw a
 * write's predecessor can land last and serve the OLD value for the whole TTL.
 * For shared art that pins old bytes under a new immutable /api/img URL.
 *
 * The pg Pool is replaced by an in-memory row store, and the test can hold any
 * statement before it touches the rows, or after it applied and before it
 * replies. No database is involved.
 */

process.env.DATABASE_URL = 'postgresql://read-cache-race:read-cache-race@127.0.0.1/read-cache-race';
delete process.env.SHINOBIX_QA_MEMORY_KV;
delete process.env.KV_PROXY_URL;
delete process.env.DISK_KV_DIR;
// /api/img below must read Postgres, not redirect to R2.
for (const name of ['R2_PUBLIC_BASE', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[name];

type Row = { value: unknown; expires_at: string | null };
type Params = unknown[];
type Deferred = { promise: Promise<void>; resolve: () => void };
type Hold = {
    matches: (text: string, params: Params) => boolean;
    arrived: Deferred;
    applied: Deferred;
    apply?: Deferred;
    reply?: Deferred;
    fail?: string;
};

const rows = new Map<string, Row>();
/** Every key a SELECT read, in order. */
const selected: string[] = [];
const holds: Hold[] = [];
const originalQuery = pg.Pool.prototype.query;
const originalConnect = pg.Pool.prototype.connect;
const originalEnd = pg.Pool.prototype.end;
let storage: typeof import('./_storage.js');
let imgHandler: (req: never, res: never) => Promise<unknown>;
let bumpImageVersion: typeof import('./_image-version.js').bumpImageVersion;
let readImageVersion: typeof import('./_image-version.js').readImageVersion;

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

/**
 * Hold the next statement that matches. `apply` keeps it from touching the rows
 * until release(); `reply` lets it apply but keeps its answer back until
 * release(); `fail` makes it throw once applied, like a reply lost after the
 * commit.
 */
function hold(matches: Hold['matches'], options: { apply?: boolean; reply?: boolean; fail?: string }) {
    const entry: Hold = {
        matches,
        arrived: deferred(),
        applied: deferred(),
        apply: options.apply ? deferred() : undefined,
        reply: options.reply ? deferred() : undefined,
        fail: options.fail,
    };
    holds.push(entry);
    return {
        arrived: entry.arrived.promise,
        applied: entry.applied.promise,
        release: () => { entry.apply?.resolve(); entry.reply?.resolve(); },
    };
}

const keysOf = (params: Params): unknown[] => (Array.isArray(params[0]) ? params[0] : [params[0]]);
/** A get/hgetall or mget SELECT that reads `key`. */
const readOf = (key: string) => (text: string, params: Params) => text.startsWith('SELECT') && text.includes('FROM public.kv_store') && keysOf(params).includes(key);
/** A write statement starting with `sql` on `key`. */
const writeOf = (sql: string, key: string) => (text: string, params: Params) => text.startsWith(sql) && keysOf(params).includes(key);
const selects = (key: string) => selected.filter((item) => item === key).length;

function live(key: string): Row | undefined {
    const row = rows.get(key);
    return row && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) ? row : undefined;
}

function execute(text: string, params: Params): { rows: unknown[]; rowCount: number } {
    const key = String(params[0] ?? '');
    const none = { rows: [], rowCount: 0 };
    const put = (value: unknown, expiresAt: unknown) => { rows.set(key, { value, expires_at: (expiresAt as string | null) ?? null }); };
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return none;
    if (text.startsWith('SELECT value, expires_at FROM public.kv_store')) {
        selected.push(key);
        const row = rows.get(key);
        return row ? { rows: [structuredClone(row)], rowCount: 1 } : none;
    }
    if (text.startsWith('SELECT key, value, expires_at FROM public.kv_store')) {
        const keys = params[0] as string[];
        selected.push(...keys);
        const found = keys.flatMap((item) => { const row = live(item); return row ? [{ key: item, ...structuredClone(row) }] : []; });
        return { rows: found, rowCount: found.length };
    }
    if (text.startsWith('INSERT INTO public.kv_store (key')) {
        put(JSON.parse(String(params[1])), params[2]);
        return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO public.kv_store AS current')) {
        if (live(key)) return none;
        put(JSON.parse(String(params[1])), params[2]);
        return { rows: [{ swapped: true }], rowCount: 1 };
    }
    if (text.startsWith('UPDATE public.kv_store')) {
        if (JSON.stringify(live(key)?.value) !== JSON.stringify(JSON.parse(String(params[1])))) return none;
        put(JSON.parse(String(params[2])), params[3]);
        return { rows: [{ swapped: true }], rowCount: 1 };
    }
    if (text.startsWith('SELECT public.kv_set_nx')) {
        const available = !live(key);
        if (available) put(JSON.parse(String(params[1])), params[2]);
        return { rows: [{ kv_set_nx: available }], rowCount: 1 };
    }
    if (text.startsWith('DELETE FROM public.kv_store WHERE key = ANY')) {
        return { rows: [], rowCount: (params[0] as string[]).filter((item) => rows.delete(item)).length };
    }
    if (text.startsWith('SELECT public.kv_incr')) {
        const next = Number(live(key)?.value ?? 0) + 1;
        put(next, null);
        return { rows: [{ kv_incr: String(next) }], rowCount: 1 };
    }
    if (text.startsWith('SELECT public.kv_hset')) {
        put({ ...(live(key)?.value as Record<string, unknown> | undefined), ...JSON.parse(String(params[1])) }, null);
        return { rows: [{}], rowCount: 1 };
    }
    if (text.startsWith('SELECT public.kv_hdel')) {
        const next = { ...(live(key)?.value as Record<string, unknown> | undefined) };
        for (const field of params[1] as string[]) delete next[field];
        put(next, null);
        return { rows: [{}], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in the read-cache race test: ${text}`);
}

async function query(sql: unknown, params: Params = []): Promise<unknown> {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    const at = holds.findIndex((entry) => entry.matches(text, params));
    const held = at >= 0 ? holds.splice(at, 1)[0] : undefined;
    held?.arrived.resolve();
    if (held?.apply) await held.apply.promise;
    const result = execute(text, params);
    held?.applied.resolve();
    if (held?.reply) await held.reply.promise;
    if (held?.fail) throw new Error(held.fail);
    return result;
}

before(async () => {
    pg.Pool.prototype.query = query as typeof pg.Pool.prototype.query;
    // compareSetMany runs on a checked-out client; this store has no isolation
    // to model, so the client is the same row store.
    pg.Pool.prototype.connect = (async () => ({
        query: (sql: unknown, params?: Params) => query(sql, params),
        release: () => undefined,
    })) as unknown as typeof pg.Pool.prototype.connect;
    pg.Pool.prototype.end = (async () => undefined) as typeof pg.Pool.prototype.end;
    storage = await import('./_storage.js');
    imgHandler = (await import('./img.js')).default as unknown as typeof imgHandler;
    ({ bumpImageVersion, readImageVersion } = await import('./_image-version.js'));
});

beforeEach(() => {
    // Each test uses its own keys, so the process cache never carries over.
    rows.clear();
    selected.length = 0;
    holds.length = 0;
});

after(async () => {
    await storage?.closeStoragePool();
    pg.Pool.prototype.query = originalQuery;
    pg.Pool.prototype.connect = originalConnect;
    pg.Pool.prototype.end = originalEnd;
});

const art = (tag: string) => `data:image/png;base64,${Buffer.from(tag).toString('base64')}`;
const OLD_ART = art('old-art');
const NEW_ART = art('new-art');

async function getImage(search: Record<string, string>) {
    const out = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; return res; },
        status: (code: number) => { out.status = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        send: (body: unknown) => { out.body = body; return res; },
        end: () => res,
        redirect: (code: number, url: string) => { out.status = code; out.headers.location = url; return res; },
    };
    const req = { method: 'GET', query: search, headers: {}, socket: { remoteAddress: '10.0.0.7' } };
    await imgHandler(req as never, res as never);
    return out;
}

test('/api/img under the new version serves the replaced art, not what a slow read SELECTed before the replace', async (t) => {
    // /api/img races each read against an 8 s timer that it never clears.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const id = 'card:race-img';
    rows.set(`shared:img:${id}`, { value: OLD_ART, expires_at: null });
    rows.set('shared:imgver:card', { value: 4, expires_at: null });
    // A request at the current version starts reading the image row. Its
    // SELECT sees the old bytes, but its answer comes back last.
    const slow = hold(readOf(`shared:img:${id}`), { reply: true });
    const oldRequest = getImage({ id, v: '4' });
    await slow.applied;
    // The upload (api/images.ts): replace the image's row, then retire the
    // cached URLs.
    await storage.kv.set(`shared:img:${id}`, NEW_ART);
    await bumpImageVersion('card');
    assert.equal(await readImageVersion('card'), '5');
    slow.release();
    assert.deepEqual((await oldRequest).body, Buffer.from('old-art'), 'the slow read answered with the bytes it SELECTed');

    const fresh = await getImage({ id, v: '5' });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.deepEqual(fresh.body, Buffer.from('new-art'), 'the new version must never be served the old bytes, immutable');
});

const READERS = {
    get: (key: string) => storage.kv.get(key),
    mget: async (key: string) => (await storage.kv.mget(key))[0],
};
const REPLACERS = {
    set: (key: string) => storage.kv.set(key, NEW_ART),
    compareSet: (key: string) => storage.kv.compareSet(key, OLD_ART, NEW_ART),
    compareSetMany: (key: string) => storage.kv.compareSetMany!([{ op: 'cas', key, expected: OLD_ART, value: NEW_ART }]),
};

for (const [reader, read] of Object.entries(READERS)) {
    for (const [writer, write] of Object.entries(REPLACERS)) {
        test(`a slow ${reader} that SELECTed the predecessor cannot re-cache it over a ${writer} that landed meanwhile`, async () => {
            const key = `shared:img:card:slow-${reader}-${writer}`;
            rows.set(key, { value: OLD_ART, expires_at: null });
            const slow = hold(readOf(key), { reply: true });
            const pending = read(key);
            await slow.applied;
            assert.ok(await write(key));
            slow.release();
            assert.equal(await pending, OLD_ART, 'the read did SELECT the predecessor');
            const before = selects(key);
            assert.equal(await read(key), NEW_ART, 'the cache keeps the write');
            assert.equal(selects(key), before, 'served from the write\'s own cache entry, without a SELECT');
        });
    }

    test(`a slow ${reader} of an absent key cannot cache "absent" over a set-if-absent that landed meanwhile`, async () => {
        const key = `shared:img:card:slow-${reader}-nx`;
        const slow = hold(readOf(key), { reply: true });
        const pending = read(key);
        await slow.applied;
        assert.equal(await storage.kv.set(key, NEW_ART, { nx: true }), 'OK');
        slow.release();
        assert.equal(await pending, null, 'the read did SELECT nothing');
        assert.equal(await read(key), NEW_ART, 'a new image is not reported missing for the cache TTL');
    });
}

test('a slow hgetall cannot re-cache a field that hdel removed meanwhile', async () => {
    const key = 'shared:imgfields:race-hdel';
    rows.set(key, { value: { 'card:gone': OLD_ART, 'card:kept': NEW_ART }, expires_at: null });
    const slow = hold(readOf(key), { reply: true });
    const pending = storage.kv.hgetall(key);
    await slow.applied;
    await storage.kv.hdel(key, 'card:gone');
    slow.release();
    assert.deepEqual(await pending, { 'card:gone': OLD_ART, 'card:kept': NEW_ART });
    assert.deepEqual(await storage.kv.hgetall(key), { 'card:kept': NEW_ART }, 'a deleted image is not served from the cache');
});

// Writes that do not cache their own value. A read that starts while one is in
// flight can SELECT the predecessor and even finish first; only the write's
// second stamp, once it settles, keeps that row out of the cache.
const IN_FLIGHT = [
    { name: 'incr', sql: 'SELECT public.kv_incr', key: 'shared:imgver:in-flight', was: 4, now: 5, write: (key: string) => storage.kv.incr(key) },
    { name: 'del', sql: 'DELETE FROM public.kv_store', key: 'shared:img:card:in-flight-del', was: OLD_ART, now: null, write: (key: string) => storage.kv.del(key) },
    { name: 'hset', sql: 'SELECT public.kv_hset', key: 'shared:imgfields:in-flight-hset', was: { a: OLD_ART }, now: { a: NEW_ART }, write: (key: string) => storage.kv.hset(key, { a: NEW_ART }) },
    { name: 'hdel', sql: 'SELECT public.kv_hdel', key: 'shared:imgfields:in-flight-hdel', was: { a: OLD_ART, b: NEW_ART }, now: { b: NEW_ART }, write: (key: string) => storage.kv.hdel(key, 'a') },
];

for (const { name, sql, key, was, now, write } of IN_FLIGHT) {
    test(`a read made while ${name} was in flight is not served once ${name} lands`, async () => {
        rows.set(key, { value: was, expires_at: null });
        const writing = hold(writeOf(sql, key), { apply: true });
        const pending = write(key);
        await writing.arrived;
        assert.deepEqual(await storage.kv.get(key), was, 'a read in between still SELECTs the predecessor');
        writing.release();
        await pending;
        assert.deepEqual(await storage.kv.get(key), now);
    });
}

test('a write whose reply is lost leaves no cached predecessor behind', async () => {
    const key = 'shared:img:card:lost-reply';
    rows.set(key, { value: OLD_ART, expires_at: null });
    const writing = hold(writeOf('INSERT INTO public.kv_store (key', key), { apply: true, fail: 'injected lost reply' });
    const pending = storage.kv.set(key, NEW_ART);
    await writing.arrived;
    assert.equal(await storage.kv.get(key), OLD_ART, 'a read in between still SELECTs the predecessor');
    writing.release();
    await assert.rejects(pending, /injected lost reply/);
    assert.equal(rows.get(key)?.value, NEW_ART, 'the write did land');
    assert.equal(await storage.kv.get(key), NEW_ART, 'the next read goes back to the database');
});

test('of two writes in flight, the one that replies last is not cached over a later commit', async () => {
    const key = 'shared:img:card:two-writers';
    rows.set(key, { value: OLD_ART, expires_at: null });
    // The first write commits first, but its reply is held back.
    const first = hold(writeOf('INSERT INTO public.kv_store (key', key), { reply: true });
    const firstWrite = storage.kv.set(key, art('first'));
    await first.applied;
    await storage.kv.set(key, art('second'));
    first.release();
    await firstWrite;
    assert.equal(rows.get(key)?.value, art('second'), 'the database kept the later commit');
    assert.equal(await storage.kv.get(key), art('second'), 'the earlier commit, whose reply came last, is not served');
});

test('reads and writes that do not overlap still cache as before', async () => {
    const key = 'shared:img:card:quiet';
    rows.set(key, { value: OLD_ART, expires_at: null });
    assert.equal(await storage.kv.get(key), OLD_ART);
    assert.equal(await storage.kv.get(key), OLD_ART);
    assert.equal(selects(key), 1, 'the second read is a cache hit');
    await storage.kv.set(key, NEW_ART);
    assert.equal(await storage.kv.get(key), NEW_ART);
    assert.ok(await storage.kv.compareSet(key, NEW_ART, art('third')));
    assert.equal(await storage.kv.get(key), art('third'));
    assert.ok(await storage.kv.compareSetMany!([{ op: 'cas', key, expected: art('third'), value: art('fourth') }]));
    assert.deepEqual(await storage.kv.mget(key), [art('fourth')]);
    assert.equal(selects(key), 1, 'every write was cached through');
});

test('stamps stay bounded, skip keys that are never cached, and a read that outlived them does not cache', async () => {
    const instance = await import(`./_storage.ts?stamps=${Date.now()}`) as typeof import('./_storage.js');
    try {
        for (let i = 0; i < 20; i++) await instance.kv.set(`pvp:never-cached-${i}`, i);
        assert.equal(instance._readCacheSizesForTest().stamps, 0, 'keys that are never cached are never stamped');

        const key = 'shared:img:card:outlived';
        rows.set(key, { value: OLD_ART, expires_at: null });
        const slow = hold(readOf(key), { reply: true });
        const pending = instance.kv.get(key);
        await slow.applied;
        for (let i = 0; i <= 5_000; i++) await instance.kv.set(`shared:img:card:filler-${i}`, i);
        assert.equal(instance._readCacheSizesForTest().stamps, 5_000, 'one stamp per recently written key, capped like the cache');
        slow.release();
        assert.equal(await pending, OLD_ART);
        const before = selects(key);
        assert.equal(await instance.kv.get(key), OLD_ART);
        assert.equal(selects(key), before + 1, 'its key might have been written while its stamp was forgotten, so it was not cached');
    } finally {
        await instance.closeStoragePool();
    }
});

test('closing the store forgets every stamp, so a read still in flight cannot refill the cache', async () => {
    const instance = await import(`./_storage.ts?closing=${Date.now()}`) as typeof import('./_storage.js');
    const key = 'shared:img:card:closing';
    rows.set(key, { value: OLD_ART, expires_at: null });
    await instance.kv.set('shared:img:card:closing-neighbour', NEW_ART);
    const slow = hold(readOf(key), { reply: true });
    const pending = instance.kv.get(key);
    await slow.applied;
    await instance.closeStoragePool();
    slow.release();
    assert.equal(await pending, OLD_ART);
    assert.deepEqual(instance._readCacheSizesForTest(), { entries: 0, stamps: 0 });
});
