import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

/*
 * /api/img serves a versioned request immutable only if the category has
 * already reached that version (isPublishedImageVersion in
 * api/_image-version.ts). A `v` above the counter is the URL the category's
 * next replace will hand out. Cloudflare edge-caches /api/img, so one
 * immutable answer to it would pin today's art under that URL for a year.
 *
 * Real handlers on the isolated in-memory store. R2 is a fake bucket behind a
 * mocked fetch. Only R2_PUBLIC_BASE is set, so reads redirect and nothing here
 * writes to R2.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'img-version-gate-test-admin';
delete process.env.IMAGE_LEGACY_HASH_WRITE;
for (const name of ['R2_PUBLIC_BASE', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    delete process.env[name];
}

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body: unknown; headers: Record<string, string> };

let kv: typeof import('./_storage.js').kv;
let imagesHandler: Handler;
let imgHandler: Handler;
let readImageVersion: typeof import('./_image-version.js').readImageVersion;
let clearProcCache: () => void;

/** Object keys the fake bucket holds, and every request R2 received. */
const bucket = new Set<string>();
const r2Requests: string[] = [];

async function fakeR2(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const href = String(url);
    r2Requests.push(`${init.method ?? 'GET'} ${href}`);
    const key = decodeURIComponent(new URL(href).pathname.slice(1));
    return new Response(null, { status: bucket.has(key) ? 200 : 404 });
}

/** Turn R2 reads on, the way R2_PUBLIC_BASE does in production. */
function withR2(t: TestContext) {
    process.env.R2_PUBLIC_BASE = 'https://img.example.com';
    t.mock.method(globalThis, 'fetch', fakeR2);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    imagesHandler = (await import('./images.js')).default as unknown as Handler;
    imgHandler = (await import('./img.js')).default as unknown as Handler;
    ({ readImageVersion } = await import('./_image-version.js'));
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
});

beforeEach(async () => {
    clearProcCache();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.R2_PUBLIC_BASE;
    bucket.clear();
    r2Requests.length = 0;
});

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATED = 'public, max-age=300, stale-while-revalidate=86400';

const png = (tag: string) => `data:image/png;base64,${Buffer.from(`image-${tag}`).toString('base64')}`;

async function call(handler: Handler, method: string, query: Record<string, string> = {}, body?: unknown): Promise<Out> {
    const out: Out = { statusCode: 200, body: undefined, headers: {} };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; return res; },
        status: (code: number) => { out.statusCode = code; return res; },
        json: (value: unknown) => { out.body = value; return res; },
        send: (value: unknown) => { out.body = value; return res; },
        end: () => res,
        redirect: (code: number, url: string) => { out.statusCode = code; out.headers.location = url; return res; },
    };
    const req = {
        method,
        query,
        body,
        headers: { 'x-admin-password': 'img-version-gate-test-admin', 'x-forwarded-for': '10.0.0.90' },
        socket: { remoteAddress: '10.0.0.90' },
    };
    await handler(req as never, res as never);
    return out;
}

const upload = (id: string, image: string) => call(imagesHandler, 'POST', {}, { id, image });
const getImg = (id: string, v?: string) => call(imgHandler, 'GET', v === undefined ? { id } : { id, v });

/** Put a category at `version`, as that many replaces would have. */
const setVersion = (cat: string, version: number) => kv.set(`shared:imgver:${cat}`, version);

/** Make every version-counter read throw, the way a storage outage does. */
function failVersionReads(t: TestContext) {
    const realGet = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (key: string) => {
        if (key.startsWith('shared:imgver:')) throw new Error('injected version read failure');
        return realGet(key);
    });
}

async function turnsUntil(done: () => boolean) {
    for (let turn = 0; turn < 1000 && !done(); turn++) await new Promise((resolve) => setImmediate(resolve));
}

describe('/api/img with a version the category has not reached', () => {
    it('is not served immutable, so it cannot pin today\'s art under the next replace\'s URL', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] }); // /api/img never clears its read timers
        await kv.set('shared:img:card:future', png('today'));
        await setVersion('card', 44);
        const out = await getImg('card:future', '45');
        assert.equal(out.statusCode, 200, 'the art is still served');
        assert.deepEqual(out.body, Buffer.from('image-today'));
        assert.equal(out.headers['cache-control'], REVALIDATED, 'the short TTL a request with no version gets');
    });

    it('redirects to the unversioned R2 copy, and never fetches the future R2 URL', async (t) => {
        withR2(t);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        bucket.add('card/r2-future');
        await setVersion('card', 44);
        const out = await getImg('card:r2-future', '45');
        assert.equal(out.statusCode, 302);
        assert.equal(out.headers.location, 'https://img.example.com/card/r2-future', 'no ?v= for a version nobody has been handed');
        assert.equal(out.headers['cache-control'], REVALIDATED);
        assert.deepEqual(r2Requests, ['HEAD https://img.example.com/card/r2-future'],
            'the server never requests the future R2 URL, so it never fills the R2 edge cache under it');
    });

    it('keeps the short TTL for an image that is a link', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:linked', 'https://cdn.example.com/art.png');
        await setVersion('card', 44);
        const out = await getImg('card:linked', '45');
        assert.equal(out.statusCode, 302);
        assert.equal(out.headers.location, 'https://cdn.example.com/art.png');
        assert.equal(out.headers['cache-control'], 'public, max-age=300');
    });

    it('is served immutable, with the new art, once a replace reaches it', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:next', png('old'));
        const early = await getImg('card:next', '1');
        assert.deepEqual(early.body, Buffer.from('image-old'));
        assert.equal(early.headers['cache-control'], REVALIDATED, 'asked for before any replace published it');
        assert.equal((await upload('card:next', png('new'))).statusCode, 200);
        assert.equal(await readImageVersion('card'), '1', 'the replace published the version asked for early');
        const later = await getImg('card:next', '1');
        assert.deepEqual(later.body, Buffer.from('image-new'), 'the URL the replace hands out shows the new art');
        assert.equal(later.headers['cache-control'], IMMUTABLE);
    });
});

describe('/api/img with the current or an older version', () => {
    it('stays immutable', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:kept', png('k'));
        await setVersion('card', 44);
        for (const v of ['44', '43', '0']) {
            const out = await getImg('card:kept', v);
            assert.equal(out.statusCode, 200);
            assert.deepEqual(out.body, Buffer.from('image-k'));
            assert.equal(out.headers['cache-control'], IMMUTABLE, `v=${v}`);
        }
    });

    it('keeps its versioned R2 redirect', async (t) => {
        withR2(t);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        bucket.add('card/r2-kept');
        await setVersion('card', 44);
        for (const v of ['44', '43']) {
            const out = await getImg('card:r2-kept', v);
            assert.equal(out.statusCode, 302);
            assert.equal(out.headers.location, `https://img.example.com/card/r2-kept?v=${v}`);
            assert.equal(out.headers['cache-control'], IMMUTABLE, `v=${v}`);
        }
    });

    it('keeps an image that is a link immutable', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:linked-kept', 'https://cdn.example.com/kept.png');
        await setVersion('card', 44);
        const out = await getImg('card:linked-kept', '44');
        assert.equal(out.headers.location, 'https://cdn.example.com/kept.png');
        assert.equal(out.headers['cache-control'], IMMUTABLE);
    });
});

describe('/api/img when the version cannot be read', () => {
    it('serves the art with the short TTL after a failed read', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:unread', png('u'));
        await setVersion('card', 44);
        failVersionReads(t);
        const out = await getImg('card:unread', '44');
        assert.equal(out.statusCode, 200, 'the art is still served');
        assert.deepEqual(out.body, Buffer.from('image-u'));
        assert.equal(out.headers['cache-control'], REVALIDATED, 'an unknown version is not the current one');
    });

    it('still redirects to R2 after a failed read, unversioned', async (t) => {
        withR2(t);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        bucket.add('card/r2-unread');
        await setVersion('card', 44);
        failVersionReads(t);
        const out = await getImg('card:r2-unread', '44');
        assert.equal(out.statusCode, 302);
        assert.equal(out.headers.location, 'https://img.example.com/card/r2-unread');
        assert.equal(out.headers['cache-control'], REVALIDATED);
    });

    it('holds the R2 redirect for at most 2 s while the read hangs', async (t) => {
        withR2(t);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        bucket.add('card/r2-slow');
        let stalled = false;
        const realGet = kv.get.bind(kv);
        t.mock.method(kv, 'get', (key: string) => {
            if (key !== 'shared:imgver:card') return realGet(key);
            stalled = true;
            return new Promise(() => undefined);
        });
        let settled = false;
        const pending = getImg('card:r2-slow', '44').finally(() => { settled = true; });
        await turnsUntil(() => stalled);
        assert.ok(stalled, 'the handler reached the version read');
        t.mock.timers.tick(2_000);
        await turnsUntil(() => settled);
        assert.ok(settled, 'the version read gave up after 2 s instead of waiting for the database');
        const out = await pending;
        assert.equal(out.statusCode, 302);
        assert.equal(out.headers.location, 'https://img.example.com/card/r2-slow');
        assert.equal(out.headers['cache-control'], REVALIDATED);
    });
});

describe('/api/img read order', () => {
    it('reads the version before the bytes, so a replace landing mid-request cannot pin the old art', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:race', png('old'));
        const realGet = kv.get.bind(kv);
        let replaced = false;
        t.mock.method(kv, 'get', async (key: string) => {
            const value = await realGet(key);
            if (key === 'shared:img:card:race' && !replaced) {
                // The replace lands just after this request read the old bytes.
                // It stores the new bytes first and bumps last, as api/images.ts does.
                replaced = true;
                await kv.set('shared:img:card:race', png('new'));
                await kv.incr('shared:imgver:card');
            }
            return value;
        });
        const raced = await getImg('card:race', '1');
        assert.ok(replaced, 'the replace landed during the request');
        assert.deepEqual(raced.body, Buffer.from('image-old'));
        assert.equal(raced.headers['cache-control'], REVALIDATED,
            'v=1 was not published when the version was read, so the old bytes are not pinned under it');
        const after = await getImg('card:race', '1');
        assert.deepEqual(after.body, Buffer.from('image-new'));
        assert.equal(after.headers['cache-control'], IMMUTABLE);
    });
});

describe('/api/img without a usable version', () => {
    it('keeps the short TTL and costs no version read', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        await kv.set('shared:img:card:plain', png('p'));
        await setVersion('card', 44);
        const realGet = kv.get.bind(kv);
        const reads: string[] = [];
        t.mock.method(kv, 'get', (key: string) => { reads.push(key); return realGet(key); });
        for (const v of [undefined, 'qa', '-1', '1'.repeat(21)]) {
            const out = await getImg('card:plain', v);
            assert.equal(out.statusCode, 200);
            assert.equal(out.headers['cache-control'], REVALIDATED, `v=${String(v)}`);
        }
        assert.deepEqual(reads.filter((key) => key.startsWith('shared:imgver:')), [],
            'only a well-formed version is checked against the counter');
    });
});
