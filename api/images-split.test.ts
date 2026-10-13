import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

/*
 * The shared-row split (docs/SHARED_HASH_ROW_SPLIT_PLAN.md, Deploy 2): an
 * upload writes only the image's own row `shared:img:<id>`, manifests list ids
 * by key scan plus the frozen legacy rows, and readers fall back to those rows
 * only for an id with no row. Driven through the real handlers on the isolated
 * in-memory store.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'images-split-test-admin';
delete process.env.IMAGE_LEGACY_HASH_WRITE;

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body: unknown; headers: Record<string, string> };

let kv: typeof import('./_storage.js').kv;
let readImageValues: typeof import('./images.js').readImageValues;
let imagesHandler: Handler;
let imgHandler: Handler;
let bloodlinesHandler: Handler;
let reseedLeaderPortraits: typeof import('./admin/server-reset.js').reseedLeaderPortraits;
let imageStore: typeof import('./_image-store.js');
let imageStoreHandler: Handler;
let clearProcCache: () => void;
let readImageVersion: typeof import('./_image-version.js').readImageVersion;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ readImageValues } = await import('./images.js'));
    imagesHandler = (await import('./images.js')).default as unknown as Handler;
    imgHandler = (await import('./img.js')).default as unknown as Handler;
    bloodlinesHandler = (await import('./bloodlines/list.js')).default as unknown as Handler;
    ({ reseedLeaderPortraits } = await import('./admin/server-reset.js'));
    imageStore = await import('./_image-store.js');
    imageStoreHandler = (await import('./admin/image-store.js')).default as unknown as Handler;
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
    ({ readImageVersion } = await import('./_image-version.js'));
});

beforeEach(async () => {
    clearProcCache();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

const png = (tag: string) => `data:image/png;base64,${Buffer.from(`image-${tag}`).toString('base64')}`;

function fakeReq(method: string, query: Record<string, string> = {}, body?: unknown) {
    return {
        method,
        query,
        body,
        headers: { 'x-admin-password': 'images-split-test-admin', 'x-forwarded-for': '10.0.0.88' },
        socket: { remoteAddress: '10.0.0.88' },
    } as never;
}

function fakeRes() {
    const out: Out = { statusCode: 200, body: undefined, headers: {} };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; return res; },
        status: (code: number) => { out.statusCode = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        send: (body: unknown) => { out.body = body; return res; },
        end: () => res,
        redirect: (code: number, url: string) => { out.statusCode = code; out.headers.location = url; return res; },
    };
    return { res: res as never, out };
}

async function call(handler: Handler, method: string, query: Record<string, string> = {}, body?: unknown): Promise<Out> {
    const { res, out } = fakeRes();
    await handler(fakeReq(method, query, body), res);
    return out;
}

const upload = (id: string, image: string) => call(imagesHandler, 'POST', {}, { id, image });

/** Every storage method that can write. */
const WRITE_METHODS = ['set', 'compareSet', 'compareSetMany', 'del', 'delIfEqual', 'incr', 'hset', 'hdel'] as const;
type Mockable = Record<(typeof WRITE_METHODS)[number], (...args: unknown[]) => Promise<unknown>>;

/** Record every write (method + first key) while still performing it. */
function recordWrites(t: TestContext): string[] {
    const writes: string[] = [];
    const methods = kv as unknown as Mockable;
    for (const method of WRITE_METHODS) {
        const real = (methods[method] as (...args: unknown[]) => Promise<unknown>).bind(kv);
        t.mock.method(methods, method, (...args: unknown[]) => {
            const first = args[0];
            const key = Array.isArray(first) ? (first as Array<{ key: string }>).map((op) => op.key).join('+') : String(first);
            writes.push(`${method} ${key}`);
            return real(...args);
        });
    }
    return writes;
}

/** Make every storage write throw. */
function forbidWrites(t: TestContext): string[] {
    const attempted: string[] = [];
    const methods = kv as unknown as Mockable;
    for (const method of WRITE_METHODS) {
        t.mock.method(methods, method, async (key: unknown) => {
            attempted.push(`${method} ${String(key)}`);
            throw new Error(`unexpected write: ${method} ${String(key)}`);
        });
    }
    return attempted;
}

const legacyRowWrites = (writes: string[]) => writes.filter((w) => /^\S+ shared:(imgfields|images)[:+]?/.test(w) || /^\S+ shared:images$/.test(w));

describe('uploads (POST /api/images)', () => {
    it('write only the image\'s own row, never the 9-16 MB category rows', async (t) => {
        await kv.set('shared:imgfields:avatar', { 'avatar:old': png('old') });
        const writes = recordWrites(t);
        const out = await upload('avatar:newbie', png('a'));
        assert.equal(out.statusCode, 200);
        assert.equal(await kv.get('shared:img:avatar:newbie'), png('a'));
        assert.deepEqual(legacyRowWrites(writes), [], `writes: ${writes.join(', ')}`);
        assert.deepEqual(await kv.get('shared:imgfields:avatar'), { 'avatar:old': png('old') }, 'the frozen hash is untouched');
    });

    it('leave the category version alone for a brand-new id, and bump it on a replace', async () => {
        assert.equal((await upload('avatar:first', png('1'))).statusCode, 200);
        assert.equal(await readImageVersion('avatar'), '0', 'a new id leaves every cached avatar URL valid');
        assert.equal((await upload('avatar:first', png('2'))).statusCode, 200);
        assert.equal(await readImageVersion('avatar'), '1', 'a replace retires the cached URLs');
        assert.equal(await kv.get('shared:img:avatar:first'), png('2'));
    });

    it('bump for an id the frozen legacy rows still serve without a row of its own', async () => {
        await kv.set('shared:imgfields:pet', { 'pet:legacy-only': png('old') });
        assert.equal((await upload('pet:legacy-only', png('new'))).statusCode, 200);
        assert.equal(await readImageVersion('pet'), '1', 'cached URLs could still hold the legacy bytes');
    });

    it('fail the upload when the image row cannot be written', async (t) => {
        const real = kv.set.bind(kv);
        t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) => {
            if (key === 'shared:img:card:broken') throw new Error('injected image-row write failure');
            return real(key, value, opts);
        });
        const out = await upload('card:broken', png('c'));
        assert.equal(out.statusCode, 500);
        assert.deepEqual(out.body, { error: 'Internal server error.' });
        t.mock.restoreAll();
        assert.equal(await kv.get('shared:img:card:broken'), null);
        assert.equal(await readImageVersion('card'), '0');
    });

    it('take the pre-split path, hash write included, with the rollback lever on', async () => {
        process.env.IMAGE_LEGACY_HASH_WRITE = '1';
        try {
            assert.equal((await upload('card:rolled-back', png('r'))).statusCode, 200);
        } finally {
            delete process.env.IMAGE_LEGACY_HASH_WRITE;
        }
        assert.deepEqual(await kv.get('shared:imgfields:card'), { 'card:rolled-back': png('r') });
        assert.equal(await kv.get('shared:img:card:rolled-back'), png('r'));
        assert.equal(await readImageVersion('card'), '1', 'the pre-split path always bumps');
    });
});

describe('deletes (DELETE /api/images)', () => {
    it('remove the image from its row and the legacy rows, all before the version bump', async (t) => {
        await kv.set('shared:img:card:gone', png('g'));
        await kv.set('shared:imgfields:card', { 'card:gone': png('g'), 'card:keep': png('k') });
        await kv.set('shared:images:card', { 'card:gone': png('g'), 'card:old': png('o') });
        const writes = recordWrites(t);
        assert.equal((await call(imagesHandler, 'DELETE', { id: 'card:gone' })).statusCode, 200);
        assert.equal(await kv.get('shared:img:card:gone'), null);
        assert.deepEqual(await kv.get('shared:imgfields:card'), { 'card:keep': png('k') });
        assert.deepEqual(await kv.get('shared:images:card'), { 'card:old': png('o') });
        assert.equal(await readImageVersion('card'), '1');
        const rowDelete = writes.indexOf('del shared:img:card:gone');
        const bump = writes.indexOf('incr shared:imgver:card');
        assert.ok(rowDelete >= 0 && bump > rowDelete, `the row goes before the bump: ${writes.join(', ')}`);
    });

    it('fail without bumping when the image row cannot be removed, and finish on a retry', async (t) => {
        await kv.set('shared:img:card:stuck', png('s'));
        const real = kv.del.bind(kv);
        t.mock.method(kv, 'del', async (...keys: string[]) => {
            if (keys.includes('shared:img:card:stuck')) throw new Error('injected image-row delete failure');
            return real(...keys);
        });
        assert.equal((await call(imagesHandler, 'DELETE', { id: 'card:stuck' })).statusCode, 500);
        assert.equal(await readImageVersion('card'), '0');
        t.mock.restoreAll();
        assert.equal((await call(imagesHandler, 'DELETE', { id: 'card:stuck' })).statusCode, 200);
        assert.equal(await kv.get('shared:img:card:stuck'), null);
        assert.equal(await readImageVersion('card'), '1');
    });
});

describe('reads', () => {
    it('full-content mode serves each image\'s own row, and the legacy rows only for rowless ids', async () => {
        await kv.set('shared:imgfields:card', { 'card:a': png('old-a'), 'card:b': png('old-b'), 'card:tomb': '' });
        await kv.set('shared:images:card', { 'card:c': png('blob-c') });
        await kv.set('shared:img:card:a', png('new-a'));
        await kv.set('shared:img:card:d', png('d'));
        const out = await call(imagesHandler, 'GET', { cat: 'card' });
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, {
            'card:a': png('new-a'), 'card:b': png('old-b'), 'card:c': png('blob-c'), 'card:d': png('d'),
        });
        const manifest = await call(imagesHandler, 'GET', { cat: 'card', ids: '1' });
        assert.deepEqual((manifest.body as string[]).sort(), ['card:a', 'card:b', 'card:c', 'card:d']);
    });

    it('read the legacy rows only when an id has no row of its own', async (t) => {
        await kv.set('shared:img:bloodline:x', png('x'));
        await kv.set('shared:imgfields:bloodline', { 'bloodline:x': png('old-x'), 'bloodline:y': png('y') });
        const hgetall = t.mock.method(kv, 'hgetall');
        assert.deepEqual(await readImageValues('bloodline', ['bloodline:x']), { 'bloodline:x': png('x') });
        assert.equal(hgetall.mock.callCount(), 0, 'every id had its row: the 11.6 MB hash was not read');
        assert.deepEqual(await readImageValues('bloodline', ['bloodline:x', 'bloodline:y']),
            { 'bloodline:x': png('x'), 'bloodline:y': png('y') });
        assert.ok(hgetall.mock.callCount() > 0);
    });

    it('GET /api/img serves an id only the legacy rows hold, and writes nothing', async (t) => {
        await kv.set('shared:imgfields:event', { 'event:legacy': png('legacy') });
        const attempted = forbidWrites(t);
        const out = await call(imgHandler, 'GET', { id: 'event:legacy' });
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, Buffer.from('image-legacy'));
        assert.deepEqual(attempted, [], 'no copy back into a row that would now list the image');
    });

    it('the bloodline gallery reads only the images it lists', async (t) => {
        await kv.hset('player:registry', { alice: { name: 'alice' } });
        await kv.set('save:alice', {
            character: { name: 'Alice' },
            savedBloodlines: [
                { id: 'b1', name: 'Storm', rank: 'A Rank', jutsus: [] },
                { id: 'b2', name: 'Ash', rank: 'B Rank', image: png('inline'), jutsus: [] },
            ],
        });
        await kv.set('shared:img:bloodline:b1', png('b1'));
        await kv.set('shared:imgfields:bloodline', { 'bloodline:b1': png('old-b1') });
        const hgetall = t.mock.method(kv, 'hgetall');
        const out = await call(bloodlinesHandler, 'GET');
        assert.equal(out.statusCode, 200);
        const list = (out.body as { bloodlines: Array<{ name: string; image?: string }> }).bloodlines;
        assert.deepEqual(list.map((b) => [b.name, b.image]), [['Ash', png('inline')], ['Storm', png('b1')]]);
        assert.ok(!hgetall.mock.calls.some((c) => c.arguments[0] === 'shared:imgfields:bloodline'),
            'the 11.6 MB bloodline hash is not read when every listed image has its row');
    });
});

describe('server reset', () => {
    it('reseeds the leader portraits into their own rows', async () => {
        await kv.set('game:village-leadership-images', {
            images: { 'Stormveil Village': { kage: png('kage'), elders: [png('e0'), '', png('e2')] } },
        });
        const bumps: string[] = [];
        assert.equal(await reseedLeaderPortraits(kv, async (cat) => { bumps.push(cat); }), 3);
        assert.equal(await kv.get('shared:img:leader:Stormveil Village:kage'), png('kage'));
        assert.equal(await kv.get('shared:img:leader:Stormveil Village:elder:0'), png('e0'));
        assert.equal(await kv.get('shared:img:leader:Stormveil Village:elder:2'), png('e2'));
        assert.equal(await kv.get('shared:imgfields:misc'), null, 'the misc hash is no longer written');
        assert.deepEqual(bumps, ['leader', 'misc']);
        const manifest = await call(imagesHandler, 'GET', { cat: 'leader', ids: '1' });
        assert.equal((manifest.body as string[]).length, 3, 'the leader manifest lists them by key');
    });
});

describe('rollback write-back', () => {
    it('copies new and replaced images into the legacy hash in ONE write', async (t) => {
        await kv.set('shared:imgfields:card', { 'card:replaced': png('old'), 'card:same': png('same') });
        await kv.set('shared:img:card:replaced', png('new'));
        await kv.set('shared:img:card:same', png('same'));
        await kv.set('shared:img:card:uploaded', png('up'));
        const hset = t.mock.method(kv, 'hset');
        const result = await imageStore.writeBackImageCategory('card', { store: kv });
        assert.deepEqual(result, { category: 'card', written: ['card:replaced', 'card:uploaded'], writtenCount: 2 });
        assert.equal(hset.mock.callCount(), 1);
        assert.deepEqual(await kv.get('shared:imgfields:card'), {
            'card:replaced': png('new'), 'card:same': png('same'), 'card:uploaded': png('up'),
        });
        assert.equal((await imageStore.writeBackImageCategory('card', { store: kv })).writtenCount, 0, 'a second run writes nothing');
        assert.equal(hset.mock.callCount(), 1);
    });

    it('needs confirm=<category> on the endpoint', async () => {
        await kv.set('shared:img:card:x', png('x'));
        const refused = await call(imageStoreHandler, 'POST', { cat: 'card', mode: 'write-back' });
        assert.equal(refused.statusCode, 400);
        assert.equal(await kv.get('shared:imgfields:card'), null);
        const wrongConfirm = await call(imageStoreHandler, 'POST', { cat: 'card', mode: 'write-back', confirm: 'pet' });
        assert.equal(wrongConfirm.statusCode, 400);
        const ok = await call(imageStoreHandler, 'POST', { cat: 'card', mode: 'write-back', confirm: 'card' });
        assert.equal(ok.statusCode, 200);
        assert.deepEqual(await kv.get('shared:imgfields:card'), { 'card:x': png('x') });
    });
});

/*
 * Ratchet: only the rollback paths may write the category hashes. A grep gate,
 * so it also proves it still matches real code (each allowed site is found) and
 * that it catches a new write (a synthetic offender).
 */
describe('who may write the category hashes', () => {
    const HASH_WRITE = /\.hset\(\s*(?:catHashKey\(|legacyHashKey\(|['"`]shared:imgfields)/;

    function hashWriteSites(source: string): number[] {
        return source.split('\n').flatMap((line, index) => (HASH_WRITE.test(line) ? [index] : []));
    }

    function apiSources(dir: string): Array<{ file: string; source: string }> {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : apiSources(path);
            return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
                ? [{ file: relative(process.cwd(), path).replace(/\\/g, '/'), source: readFileSync(path, 'utf8') }]
                : [];
        });
    }

    it('finds exactly the three rollback sites, each behind the lever or in write-back', () => {
        const found = apiSources('api').flatMap(({ file, source }) => hashWriteSites(source).map((line) => ({ file, line, source })));
        assert.deepEqual(found.map((f) => f.file).sort(), ['api/_image-store.ts', 'api/admin/server-reset.ts', 'api/images.ts']);
        for (const { file, line, source } of found) {
            const before = source.split('\n').slice(Math.max(0, line - 20), line + 1).join('\n');
            if (file === 'api/_image-store.ts') assert.match(before, /writeBackImageCategory/, `${file}:${line + 1} is the write-back`);
            else assert.match(before, /legacyHashWriteEnabled\(\)/, `${file}:${line + 1} is behind the rollback lever`);
        }
    });

    it('catches a new hash write (mutation check)', () => {
        assert.deepEqual(hashWriteSites('const x = 1;\n    await kv.hset(catHashKey(cat), { [id]: image });\n'), [1]);
        assert.deepEqual(hashWriteSites("await kv.hset('shared:imgfields:misc', payload);"), [0]);
        assert.deepEqual(hashWriteSites('await kv.hset(`shared:imgfields:${cat}`, payload);'), [0]);
        assert.deepEqual(hashWriteSites('await kv.hset("player:registry", payload);'), []);
    });
});
