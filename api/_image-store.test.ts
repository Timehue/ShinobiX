import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'image-store-test-admin';

type Storage = typeof import('./_storage.js');
type ImageStore = typeof import('./_image-store.js');
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: Storage['kv'];
let store: ImageStore;
let buildManifestIds: typeof import('./images.js').buildManifestIds;
let handler: Handler;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    store = await import('./_image-store.js');
    ({ buildManifestIds } = await import('./images.js'));
    handler = (await import('./admin/image-store.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

const png = (tag: string) => `data:image/png;base64,${Buffer.from(`image-${tag}`).toString('base64')}`;
const todayManifest = (cat: string) => buildManifestIds(cat, <T,>(read: Promise<T | null>) => read);

/** Every storage method that can write. An audit must call none of them. */
const WRITE_METHODS = ['set', 'compareSet', 'compareSetMany', 'del', 'delIfEqual', 'incr', 'hset', 'hdel'] as const;

function forbidWrites(t: TestContext): string[] {
    const attempted: string[] = [];
    const methods = kv as unknown as Record<(typeof WRITE_METHODS)[number], (...args: unknown[]) => Promise<unknown>>;
    for (const method of WRITE_METHODS) {
        t.mock.method(methods, method, async (key: unknown) => {
            attempted.push(`${method} ${String(key)}`);
            throw new Error(`the audit wrote: ${method} ${String(key)}`);
        });
    }
    return attempted;
}

function fakeReq(method: string, query: Record<string, string>, password: string | null = 'image-store-test-admin') {
    return {
        method,
        query,
        body: {},
        headers: { 'x-forwarded-for': '10.0.0.77', ...(password === null ? {} : { 'x-admin-password': password }) },
        socket: { remoteAddress: '10.0.0.77' },
    } as never;
}

function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.statusCode = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

/**
 * An avatar category with one of each finding:
 *   avatar:a  listed, per-image row identical            → clean
 *   avatar:b  listed, per-image bytes differ             → differing
 *   avatar:c  listed (blob only), no per-image row       → missingPerImage
 *   avatar:t  empty hash field                           → tombstone (not listed)
 *   avatar:o  per-image row only, same picture as a      → orphan + duplicate
 */
async function seedAvatarFixture() {
    await kv.set('shared:imgfields:avatar', { 'avatar:a': png('a'), 'avatar:b': png('b'), 'avatar:t': '' });
    await kv.set('shared:images:avatar', { 'avatar:c': png('c') });
    await kv.set('shared:img:avatar:a', png('a'));
    await kv.set('shared:img:avatar:b', png('b-replaced'));
    await kv.set('shared:img:avatar:o', png('a'));
    await kv.set('asset:meta:avatar:o', { id: 'avatar:o', createdBy: 'mallory', createdAt: 1_000, updatedAt: 2_000 });
    // Look-alike keys that are NOT per-image rows of this category.
    await kv.set('shared:imgver:avatar', 7);
}

describe('categoryPrefixes', () => {
    it('lists every prefix a category owns, and none for misc', () => {
        assert.deepEqual(store.categoryPrefixes('avatar'), ['avatar']);
        assert.deepEqual(store.categoryPrefixes('pet'), ['pet', 'petbody', 'petlayers', 'petsheet']);
        assert.deepEqual(store.categoryPrefixes('event'), ['event', 'vn']);
        assert.equal(store.categoryPrefixes('misc'), null);
    });
});

describe('scanCategoryIds', () => {
    it('lists per-image rows by prefix and ignores the legacy and version rows', async () => {
        await kv.set('shared:img:avatar:a', png('a'));
        await kv.set('shared:imgfields:avatar', { 'avatar:z': png('z') });
        await kv.set('shared:imgver:avatar', 3);
        await kv.set('shared:img:pet:wolf', png('wolf'));
        await kv.set('shared:img:petbody:wolf', png('wolf-body'));
        await kv.set('shared:img:vn:page-1', png('page'));
        await kv.set('shared:img:sector-base:north', png('north'));
        assert.deepEqual(await store.scanCategoryIds('avatar', kv), ['avatar:a']);
        assert.deepEqual(await store.scanCategoryIds('pet', kv), ['pet:wolf', 'petbody:wolf']);
        assert.deepEqual(await store.scanCategoryIds('event', kv), ['vn:page-1']);
        assert.deepEqual(await store.scanCategoryIds('misc', kv), ['sector-base:north'], 'misc owns only the unknown prefixes');
    });
});

describe('auditImageCategory', () => {
    it('reports orphans, missing rows, differing bytes, tombstones and duplicates', async () => {
        await seedAvatarFixture();
        const report = await store.auditImageCategory('avatar', { store: kv, todayManifest });

        assert.deepEqual(report.counts, {
            todayManifest: 3, keyScan: 3, orphans: 1, missingPerImage: 1, differing: 1, tombstones: 1, invalidPerImage: 0,
        });
        assert.deepEqual(report.orphans, [{
            id: 'avatar:o', chars: png('a').length, owner: null, uploadedBy: 'mallory', createdAt: 1_000, updatedAt: 2_000,
        }]);
        assert.deepEqual(report.missingPerImage, ['avatar:c']);
        assert.deepEqual(report.differing, [{ id: 'avatar:b', perImageChars: png('b-replaced').length, legacyChars: png('b').length }]);
        assert.deepEqual(report.tombstones, ['avatar:t']);
        assert.equal(report.duplicates.distinctImages, 2);
        assert.deepEqual(report.duplicates.groups.map(g => [g.count, g.sampleIds]), [[2, ['avatar:a', 'avatar:o']]]);
        assert.deepEqual(report.chars, {
            legacyHash: png('a').length + png('b').length,
            legacyBlob: png('c').length,
            perImage: png('a').length * 2 + png('b-replaced').length,
        });
        assert.equal(report.readOnly, true);
    });

    it('reads leader portraits still filed under misc the way the manifest and /api/img do', async () => {
        await kv.set('shared:imgfields:misc', { 'leader:Stormveil Village:kage': png('kage'), 'shrine:door': png('door') });
        await kv.set('shared:img:leader:Stormveil Village:kage', png('kage-new'));
        const report = await store.auditImageCategory('leader', { store: kv, todayManifest });
        assert.equal(report.counts.todayManifest, 1);
        assert.equal(report.counts.orphans, 0);
        assert.equal(report.counts.missingPerImage, 0);
        assert.deepEqual(report.differing.map(d => d.id), ['leader:Stormveil Village:kage']);
    });

    it('writes nothing at all', async (t) => {
        await seedAvatarFixture();
        const attempted = forbidWrites(t);
        const report = await store.auditImageCategory('avatar', { store: kv, todayManifest });
        assert.equal(report.counts.orphans, 1);
        assert.deepEqual(attempted, []);
    });

    it('refuses to audit against a manifest it could not read', async () => {
        await assert.rejects(
            store.auditImageCategory('avatar', { store: kv, todayManifest: async () => null }),
            store.ManifestUnavailableForAuditError,
        );
    });
});

describe('POST /api/admin/image-store', () => {
    it('accepts only a full admin POST for a known category in dry-run mode', async () => {
        const preflight = fakeRes();
        await handler(fakeReq('OPTIONS', {}, null), preflight.res);
        assert.equal(preflight.out.statusCode, 200);

        const get = fakeRes();
        await handler(fakeReq('GET', { cat: 'avatar' }), get.res);
        assert.equal(get.out.statusCode, 405);

        const anonymous = fakeRes();
        await handler(fakeReq('POST', { cat: 'avatar' }, null), anonymous.res);
        assert.equal(anonymous.out.statusCode, 401);

        const wrongPassword = fakeRes();
        await handler(fakeReq('POST', { cat: 'avatar' }, 'guess'), wrongPassword.res);
        assert.equal(wrongPassword.out.statusCode, 401);

        const unknown = fakeRes();
        await handler(fakeReq('POST', { cat: 'shared:imgfields:avatar' }), unknown.res);
        assert.equal(unknown.out.statusCode, 400);
        assert.match(String((unknown.out.body as { error: string }).error), /avatar, bloodline, card, event/);

        const apply = fakeRes();
        await handler(fakeReq('POST', { cat: 'avatar', mode: 'apply' }), apply.res);
        assert.equal(apply.out.statusCode, 400);
    });

    it('returns the report and writes nothing', async (t) => {
        await seedAvatarFixture();
        const attempted = forbidWrites(t);
        const ok = fakeRes();
        await handler(fakeReq('POST', { cat: 'avatar' }), ok.res);
        assert.equal(ok.out.statusCode, 200);
        const body = ok.out.body as { ok: boolean; category: string; readOnly: boolean; counts: { orphans: number } };
        assert.equal(body.ok, true);
        assert.equal(body.category, 'avatar');
        assert.equal(body.readOnly, true);
        assert.equal(body.counts.orphans, 1);
        assert.deepEqual(attempted, []);
    });

    it('runs one audit at a time', async (t) => {
        await seedAvatarFixture();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const keys = kv.keys.bind(kv);
        t.mock.method(kv, 'keys', async (pattern: string) => { await gate; return keys(pattern); });

        const first = fakeRes();
        const running = handler(fakeReq('POST', { cat: 'avatar' }), first.res);
        const second = fakeRes();
        await handler(fakeReq('POST', { cat: 'avatar' }), second.res);
        assert.equal(second.out.statusCode, 409);

        release();
        await running;
        assert.equal(first.out.statusCode, 200);
        const third = fakeRes();
        await handler(fakeReq('POST', { cat: 'avatar' }), third.res);
        assert.equal(third.out.statusCode, 200, 'the guard clears when the audit ends');
    });
});
