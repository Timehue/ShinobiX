import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

/*
 * An image id whose prefix names an Object.prototype member (`constructor:x`,
 * `toString:x`, `__proto__:x`) is an unknown prefix like any other, so it
 * belongs to 'misc'. A plain-object lookup in categoryFromId resolved it to the
 * inherited member instead: the upload skipped the 50-per-player misc cap, sat
 * in no manifest, and bumped a version key named after the function's source.
 * Driven through the real handlers on the isolated in-memory store.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'images-prototype-ids-session-secret';
process.env.ADMIN_PASSWORD = 'images-prototype-ids-admin';
delete process.env.IMAGE_LEGACY_HASH_WRITE;

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body: unknown };

let kv: typeof import('./_storage.js').kv;
let images: typeof import('./images.js');
let imagesHandler: Handler;
let imgHandler: Handler;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let clearProcCache: () => void;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    images = (await import('./images.js')) as unknown as typeof images;
    imagesHandler = images.default as unknown as Handler;
    imgHandler = (await import('./img.js')).default as unknown as Handler;
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
});

beforeEach(async () => {
    clearProcCache();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

/** Every own name on Object.prototype: constructor, toString, __proto__, hasOwnProperty, … */
const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype);
const png = (tag: string) => `data:image/png;base64,${Buffer.from(`image-${tag}`).toString('base64')}`;
const ADMIN = { 'x-admin-password': 'images-prototype-ids-admin' };

async function call(handler: Handler, method: string, query: Record<string, string>, headers: Record<string, string>, body?: unknown): Promise<Out> {
    const out: Out = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.statusCode = code; return res; },
        json: (payload: unknown) => { out.body = payload; return res; },
        send: (payload: unknown) => { out.body = payload; return res; },
        end: () => res,
        redirect: (code: number) => { out.statusCode = code; return res; },
    };
    await handler({ method, query, headers, body, socket: { remoteAddress: '10.70.0.1' } } as never, res as never);
    return out;
}

async function playerHeaders(name: string): Promise<Record<string, string>> {
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    return { 'x-player-name': name, 'x-player-token': issuePlayerToken(name)! };
}

const upload = (headers: Record<string, string>, id: string, image: string) => call(imagesHandler, 'POST', {}, headers, { id, image });

/** Record every write's method and first key while still performing it. */
function recordWrites(t: TestContext): string[] {
    const writes: string[] = [];
    const methods = kv as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of ['set', 'del', 'incr', 'hset', 'hdel']) {
        const real = methods[method].bind(kv);
        t.mock.method(methods, method, (...args: unknown[]) => {
            writes.push(`${method} ${String(args[0])}`);
            return real(...args);
        });
    }
    return writes;
}

describe('categoryFromId', () => {
    it('files every Object.prototype member name under misc, like any unknown prefix', () => {
        assert.ok(PROTOTYPE_NAMES.includes('__proto__') && PROTOTYPE_NAMES.includes('constructor'), 'the list covers the dangerous names');
        for (const name of PROTOTYPE_NAMES) {
            assert.equal(images.categoryFromId(`${name}:x`), 'misc', `${name}:x`);
            assert.equal(images.categoryFromId(`${name}:x:y`), 'misc', `${name}:x:y`);
            assert.equal(images.categoryFromId(name), 'misc', `${name} (no colon, which only an admin can send)`);
        }
    });

    it('still maps every known prefix to its own category', () => {
        for (const [prefix, category] of Object.entries(images.KNOWN_PREFIXES)) {
            assert.equal(images.categoryFromId(`${prefix}:x`), category, prefix);
        }
    });
});

describe('uploads of prototype-named ids (POST /api/images)', () => {
    it('count against the misc cap', async () => {
        const headers = await playerHeaders('prankster');
        await kv.set('upload:misc-count:prankster', 50);
        for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
            const out = await upload(headers, `${name}:x`, png(name));
            assert.equal(out.statusCode, 429, `${name}:x is a misc upload`);
            assert.equal(await kv.get(`shared:img:${name}:x`), null, `${name}:x was not stored`);
        }
    });

    it('are listed in the misc manifest, and a replace bumps only the misc version', async () => {
        const headers = await playerHeaders('tester');
        assert.equal((await upload(headers, 'toString:x', png('first'))).statusCode, 200);
        assert.equal((await upload(headers, 'toString:x', png('second'))).statusCode, 200);
        assert.equal((await upload(headers, '__proto__:y', png('proto'))).statusCode, 200);
        assert.equal(await kv.get('upload:misc-count:tester'), 3, 'each upload was charged to the misc cap');
        const manifest = await call(imagesHandler, 'GET', { cat: 'misc', ids: '1' }, {});
        assert.deepEqual(manifest.body, ['__proto__:y', 'toString:x'], 'an admin can see and remove them');
        assert.deepEqual(await kv.keys('shared:imgver:*'), ['shared:imgver:misc'], 'no version key named after a function');
    });
});

describe('GET /api/img for a prototype-named id', () => {
    it('falls back to the misc legacy rows, never to rows named after a function', async (t) => {
        const get = t.mock.method(kv, 'get');
        const hgetall = t.mock.method(kv, 'hgetall');
        const out = await call(imgHandler, 'GET', { id: 'constructor:x' }, {});
        assert.equal(out.statusCode, 404);
        const keysRead = [...get.mock.calls, ...hgetall.mock.calls].map((c) => String(c.arguments[0])).sort();
        assert.deepEqual(keysRead, ['shared:images:misc', 'shared:img:constructor:x', 'shared:imgfields:misc']);
    });
});

describe('deletes never treat an inherited name as a stored image', () => {
    it('an admin delete of a colon-less prototype name leaves the misc blob unwritten', async (t) => {
        await kv.set('shared:images:misc', { 'misc:keep': png('keep') });
        const writes = recordWrites(t);
        for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
            assert.equal((await call(imagesHandler, 'DELETE', { id }, ADMIN)).statusCode, 200, id);
        }
        assert.deepEqual(writes.filter((w) => w.startsWith('set shared:images')), [], `writes: ${writes.join(', ')}`);
        t.mock.restoreAll();
        assert.deepEqual(await kv.get('shared:images:misc'), { 'misc:keep': png('keep') });
    });

    it('a batch removal leaves a blob unwritten when none of its ids are own keys', async () => {
        const writes: string[] = [];
        const blobs = new Map<string, Record<string, string>>([['shared:images:misc', { 'misc:keep': png('keep') }]]);
        const store = {
            hdel: async (key: string) => { writes.push(`hdel ${key}`); return 0; },
            del: async (...keys: string[]) => { writes.push(`del ${keys.join('+')}`); return 0; },
            get: async (key: string) => blobs.get(key) ?? null,
            set: async (key: string) => { writes.push(`set ${key}`); return 'OK'; },
        };
        const result = await images.removeImagesBatch(['constructor', 'toString'], {
            store: store as never,
            bumpVersion: async () => undefined,
            audit: async () => undefined,
            actor: 'admin',
        });
        assert.deepEqual(result.removed, ['constructor', 'toString']);
        assert.deepEqual(writes.filter((w) => w.startsWith('set ')), [], `writes: ${writes.join(', ')}`);
    });
});
