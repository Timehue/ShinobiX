import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

/*
 * R2 holds an image's new bytes, or no copy at all, before its category version
 * moves (copyImageToR2 in api/images.ts). /api/img redirects to R2 whenever a
 * copy exists and serves a versioned request immutable, so a version bumped
 * while R2 still held the old object would let Cloudflare cache the old bytes
 * under the new URL for a year.
 *
 * Real handlers on the isolated in-memory store. R2 is a fake bucket behind a
 * mocked fetch.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'images-r2-order-test-admin';
delete process.env.IMAGE_LEGACY_HASH_WRITE;
Object.assign(process.env, {
    R2_PUBLIC_BASE: 'https://img.example.com',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
});

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body: unknown; headers: Record<string, string> };
type Deferred = { promise: Promise<void>; resolve: () => void };

let kv: typeof import('./_storage.js').kv;
let imagesHandler: Handler;
let imgHandler: Handler;
let readImageVersion: typeof import('./_image-version.js').readImageVersion;
let reseedLeaderPortraits: typeof import('./admin/server-reset.js').reseedLeaderPortraits;
let clearProcCache: () => void;

/** The fake bucket: object key → the bytes it holds, as text. */
const bucket = new Map<string, string>();
let heldPut: { arrived: Deferred; release: Deferred } | undefined;
let failPuts = false;
let failDeletes = false;

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

/** Hold the next PUT before it reaches the bucket. */
function holdNextPut() {
    const gate = { arrived: deferred(), release: deferred() };
    heldPut = gate;
    return { arrived: gate.arrived.promise, release: gate.release.resolve };
}

/** Signed S3 calls go to <account>.r2.cloudflarestorage.com/<bucket>/<key>; reads go to the public base. */
function objectKeyOf(url: string): string {
    const { hostname, pathname } = new URL(url);
    const path = decodeURIComponent(pathname.slice(1));
    return hostname.endsWith('.r2.cloudflarestorage.com') ? path.slice('bucket/'.length) : path;
}

async function fakeR2(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const key = objectKeyOf(String(url));
    const method = init.method ?? 'GET';
    if (method === 'PUT') {
        const gate = heldPut;
        heldPut = undefined;
        if (gate) { gate.arrived.resolve(); await gate.release.promise; }
        if (failPuts) return new Response(null, { status: 503 });
        bucket.set(key, Buffer.from(await (init.body as Blob).arrayBuffer()).toString());
        return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') {
        if (failDeletes) return new Response(null, { status: 503 });
        bucket.delete(key);
        return new Response(null, { status: 204 });
    }
    return new Response(null, { status: bucket.has(key) ? 200 : 404 });
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    imagesHandler = (await import('./images.js')).default as unknown as Handler;
    imgHandler = (await import('./img.js')).default as unknown as Handler;
    ({ readImageVersion } = await import('./_image-version.js'));
    ({ reseedLeaderPortraits } = await import('./admin/server-reset.js'));
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
});

beforeEach(async () => {
    clearProcCache();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    bucket.clear();
    heldPut = undefined;
    failPuts = false;
    failDeletes = false;
});

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
        headers: { 'x-admin-password': 'images-r2-order-test-admin', 'x-forwarded-for': '10.0.0.89' },
        socket: { remoteAddress: '10.0.0.89' },
    };
    await handler(req as never, res as never);
    return out;
}

const upload = (id: string, image: string) => call(imagesHandler, 'POST', {}, { id, image });

/** What the bucket held for `objectKey` each time a category version moved. */
function bucketAtEachBump(t: TestContext, objectKey: string): Array<string | undefined> {
    const seen: Array<string | undefined> = [];
    const realIncr = kv.incr.bind(kv);
    t.mock.method(kv, 'incr', async (key: string, options?: { ex?: number }) => {
        if (key.startsWith('shared:imgver:')) seen.push(bucket.get(objectKey));
        return realIncr(key, options);
    });
    return seen;
}

describe('uploads put the new bytes in R2 before the version moves', () => {
    it('a replace waits for its R2 copy, and only then bumps', async (t) => {
        t.mock.method(globalThis, 'fetch', fakeR2);
        t.mock.timers.enable({ apis: ['setTimeout'] }); // /api/img never clears its 8 s read timer
        await kv.set('shared:img:card:r2', png('old'));
        bucket.set('card/r2', 'image-old');
        const put = holdNextPut();
        const pending = upload('card:r2', png('new'));
        await put.arrived;
        assert.equal(await readImageVersion('card'), '0', 'no new version while R2 still holds the old bytes');
        put.release();
        assert.equal((await pending).statusCode, 200);
        assert.equal(bucket.get('card/r2'), 'image-new');
        assert.equal(await readImageVersion('card'), '1');
        const served = await call(imgHandler, 'GET', { id: 'card:r2', v: '1' });
        assert.equal(served.headers.location, 'https://img.example.com/card/r2?v=1', 'the new version redirects to the new copy');
    });

    it('a failed copy deletes the old R2 object before the bump, and the upload still succeeds', async (t) => {
        t.mock.method(globalThis, 'fetch', fakeR2);
        t.mock.timers.enable({ apis: ['setTimeout'] }); // /api/img never clears its 8 s read timer
        t.mock.method(console, 'error', () => {});
        await kv.set('shared:img:card:r2-fail', png('old'));
        bucket.set('card/r2-fail', 'image-old');
        failPuts = true;
        const atBump = bucketAtEachBump(t, 'card/r2-fail');
        assert.equal((await upload('card:r2-fail', png('new'))).statusCode, 200, 'R2 is best-effort');
        assert.equal(await kv.get('shared:img:card:r2-fail'), png('new'), 'Postgres holds the new art');
        assert.deepEqual(atBump, [undefined], 'the old copy was gone before the version moved');
        const served = await call(imgHandler, 'GET', { id: 'card:r2-fail', v: '1' });
        assert.equal(served.statusCode, 200, '/api/img falls back to Postgres instead of redirecting to R2');
        assert.deepEqual(served.body, Buffer.from('image-new'));
    });

    it('an image with no bytes to copy deletes the R2 copy of the art it replaces', async (t) => {
        t.mock.method(globalThis, 'fetch', fakeR2);
        t.mock.timers.enable({ apis: ['setTimeout'] }); // /api/img never clears its 8 s read timer
        await kv.set('shared:img:card:r2-link', png('old'));
        bucket.set('card/r2-link', 'image-old');
        const atBump = bucketAtEachBump(t, 'card/r2-link');
        assert.equal((await upload('card:r2-link', 'https://cdn.example.com/art.png')).statusCode, 200);
        assert.deepEqual(atBump, [undefined]);
        const served = await call(imgHandler, 'GET', { id: 'card:r2-link', v: '1' });
        assert.equal(served.headers.location, 'https://cdn.example.com/art.png', 'the link, not the old R2 copy');
    });

    it('with R2 down, the upload still succeeds and still bumps, and the log says what was left behind', async (t) => {
        t.mock.method(globalThis, 'fetch', fakeR2);
        const errors = t.mock.method(console, 'error', () => {});
        await kv.set('shared:img:card:r2-down', png('old'));
        failPuts = true;
        failDeletes = true;
        assert.equal((await upload('card:r2-down', png('new'))).statusCode, 200);
        assert.equal(await kv.get('shared:img:card:r2-down'), png('new'));
        assert.equal(await readImageVersion('card'), '1');
        assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('R2 may still serve an older copy of card:r2-down')),
            'an R2 copy that could be neither replaced nor deleted is logged');
    });

    it('a brand-new image is copied before the upload answers, and bumps nothing', async (t) => {
        t.mock.method(globalThis, 'fetch', fakeR2);
        const put = holdNextPut();
        let answered = false;
        const pending = upload('card:r2-new', png('n')).then((out) => { answered = true; return out; });
        await put.arrived;
        for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
        assert.equal(answered, false, 'the upload waits for its copy, so a later replace cannot be overtaken by it');
        put.release();
        assert.equal((await pending).statusCode, 200);
        assert.equal(bucket.get('card/r2-new'), 'image-n');
        assert.equal(await readImageVersion('card'), '0');
    });
});

describe('server reset', () => {
    it('copies the reseeded leader portraits to R2 before either bump', async (t) => {
        t.mock.method(globalThis, 'fetch', fakeR2);
        await kv.set('game:village-leadership-images', { images: { 'Stormveil Village': { kage: png('kage-new') } } });
        bucket.set('leader/Stormveil Village/kage', 'image-kage-old');
        const atBump: Array<string | undefined> = [];
        assert.equal(await reseedLeaderPortraits(kv, async () => { atBump.push(bucket.get('leader/Stormveil Village/kage')); }), 1);
        assert.deepEqual(atBump, ['image-kage-new', 'image-kage-new'], 'the leader and misc bumps both find the new copy');
    });
});
