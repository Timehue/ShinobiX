import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let crisis: typeof import('./_state.js');
let crisis80: typeof import('../world-crisis-80/_state.js');
let procCache: typeof import('../_proc-cache.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    crisis = await import('./_state.js');
    crisis80 = await import('../world-crisis-80/_state.js');
    procCache = await import('../_proc-cache.js');
});

beforeEach(async () => {
    for (const pattern of ['world:crisis:*', 'lock:world:crisis:*', 'game:announcements*', 'hall:*', 'audit:legacy']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    procCache.__clearProcCache();
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

describe('public world-crisis poll cache', () => {
    it('serves repeat polls from one build instead of re-reading the state', { concurrency: false }, async () => {
        // The very first read lazily creates the state row; that write drops the
        // frame being built, so warm up once (production already has the row).
        await crisis.readWorldCrisisProjectionCached();
        const first = await crisis.readWorldCrisisProjectionCached();
        // A write that bypasses the state API (e.g. another process during a
        // deploy overlap) is only picked up once the short TTL lapses.
        const stored = await kv.get<Record<string, unknown>>(crisis.WORLD_CRISIS_STATE_KEY);
        await kv.set(crisis.WORLD_CRISIS_STATE_KEY, { ...stored, targetPerVillage: first.targetPerVillage + 1 });
        const second = await crisis.readWorldCrisisProjectionCached();
        assert.equal(second, first, 'the second poll must reuse the cached frame');
    });

    it('shows a state write on the very next poll', { concurrency: false }, async () => {
        const before = await crisis.readWorldCrisisProjectionCached();
        const target = before.targetPerVillage === 10 ? 12 : 10;
        await crisis.applyWorldCrisisAdminAction({ action: 'set-target', targetPerVillage: target, now: 1_000 });
        const after = await crisis.readWorldCrisisProjectionCached();
        assert.equal(after.targetPerVillage, target);
        assert.deepEqual(after, await crisis.readWorldCrisisProjection(), 'the cached read must match an uncached read');
    });
});

describe('public level-80 crisis poll cache', () => {
    it('serves repeat polls from one build instead of re-reading the state', { concurrency: false }, async () => {
        await crisis80.readWorldCrisis80ProjectionCached();
        const first = await crisis80.readWorldCrisis80ProjectionCached();
        const stored = await kv.get<Record<string, unknown>>(crisis80.WORLD_CRISIS_80_STATE_KEY);
        await kv.set(crisis80.WORLD_CRISIS_80_STATE_KEY, { ...stored, targetPerVillage: first.targetPerVillage + 1 });
        const second = await crisis80.readWorldCrisis80ProjectionCached();
        assert.equal(second, first, 'the second poll must reuse the cached frame');
    });

    it('shows a state write on the very next poll', { concurrency: false }, async () => {
        const before = await crisis80.readWorldCrisis80ProjectionCached();
        const target = before.targetPerVillage === 20 ? 22 : 20;
        await crisis80.applyWorldCrisis80AdminAction({ action: 'set-target', targetPerVillage: target, now: 1_000 });
        const after = await crisis80.readWorldCrisis80ProjectionCached();
        assert.equal(after.targetPerVillage, target);
        assert.deepEqual(after, await crisis80.readWorldCrisis80Projection(), 'the cached read must match an uncached read');
    });
});

describe('edge caching of the public crisis polls', () => {
    type Handler = (req: never, res: never) => Promise<unknown>;
    async function call(path: '../world-crisis.js' | '../world-crisis-80.js', method: string) {
        const handler = (await import(path)).default as unknown as Handler;
        const headers: Record<string, string> = {};
        const out: { status: number } = { status: 200 };
        const res = {
            setHeader(key: string, value: string) { headers[key.toLowerCase()] = value; return res; },
            status(code: number) { out.status = code; return res; },
            json() { return res; }, end() { return res; },
        };
        await handler({ method, headers: { 'x-forwarded-for': '10.93.0.1' }, socket: { remoteAddress: '10.93.0.1' }, body: {} } as never, res as never);
        return { status: out.status, cacheControl: headers['cache-control'] };
    }

    it('lets the CDN hold a successful read for 5s, never a refused admin write', { concurrency: false }, async () => {
        for (const path of ['../world-crisis.js', '../world-crisis-80.js'] as const) {
            const read = await call(path, 'GET');
            assert.equal(read.status, 200);
            assert.equal(read.cacheControl, 's-maxage=5, stale-while-revalidate=5');
            const write = await call(path, 'POST');
            assert.equal(write.status, 401, 'no admin credentials');
            assert.equal(write.cacheControl, 'no-store');
        }
    });
});
