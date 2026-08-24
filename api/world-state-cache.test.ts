import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'world-state-cache-test-admin';
process.env.SESSION_SECRET = 'world-state-cache-test-secret-32-bytes';

/*
 * GET /api/world-state must stay a SHARED, publicly cacheable document.
 *
 * Two regressions this locks down, both found at the 100-200 concurrent-player
 * cap (see api/village/intel.ts for the full write-up):
 *   1. Attaching the per-viewer `villageIntel` block flipped the response to
 *      `private, no-store`. Every signed-in client's fetch is authenticated
 *      (authFetch patches window.fetch for all /api/ URLs), so that made EVERY
 *      logged-in poll an origin request instead of one per s-maxage window.
 *   2. Hashing `sectorPools` into the content ETag churned it continuously —
 *      any explore anywhere in the world changed it — so the 304 fast path
 *      never fired, even for anonymous pollers.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown>; headers: Record<string, string>; ended: boolean };

let worldState: Handler;
let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let clearProcCache: () => void;

/*
 * FIXED CLOCK, deliberately. The sector-pool keys these tests write are dated,
 * and readAllSectorPoolUsage re-derives that date from its OWN clock read inside
 * the handler — so reading the wall clock out here too makes the suite a race
 * with UTC midnight (seed at 23:59:59.9, read at 00:00:00.1, and the seeded row
 * is invisible for reasons that have nothing to do with the code under test).
 * Only Date is mocked; timers are untouched.
 */
const FIXED_NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const TODAY = new Date(FIXED_NOW).toISOString().slice(0, 10);

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
    worldState = (await import('./world-state.js')).default as unknown as Handler;
});
beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.DISABLE_VILLAGE_STORES;
    clearProcCache();
});
after(async () => {
    mock.timers.reset();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_VILLAGE_STORES;
    clearProcCache();
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, headers: {}, ended: false };
    const res = {
        setHeader: (k: string, v: string) => { out.headers[String(k).toLowerCase()] = String(v); return res; },
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => { out.ended = true; return res; },
    };
    return { res: res as never, out };
}

/** `playerName: null` = an anonymous poll (no auth headers). */
async function get(playerName: string | null, ifNoneMatch?: string): Promise<ResponseOut> {
    // Every call re-reads storage: the 3s proc frame would otherwise mask the
    // sector-pool writes these tests make between polls.
    clearProcCache();
    const { res, out } = fakeRes();
    const headers: Record<string, string> = {};
    if (playerName) {
        headers['x-player-name'] = playerName;
        headers['x-player-token'] = issuePlayerToken(playerName) ?? '';
    }
    if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
    await worldState({ method: 'GET', headers, socket: { remoteAddress: '127.0.0.1' } } as never, res);
    return out;
}

async function seedPlayer(name: string, village: string) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 20, ryo: 0, stats: {}, jutsu: [], equipment: {}, inventory: [], itemStacks: [] } });
}

describe('GET /api/world-state cacheability', { concurrency: false }, () => {
    it('stays publicly cacheable for a SIGNED-IN poll and carries no per-viewer block', async () => {
        await seedPlayer('moonrunner', 'Moonshadow Village');
        // The viewer's village holds intel — the old code would have attached it.
        await kv.set('village:intel:moonshadowvillage', {
            village: 'Moonshadow Village',
            sectors: { 12: { points: 900, lastAt: Date.now(), expiresAt: Date.now() + 86_400_000 } },
        });

        const signedIn = await get('moonrunner');
        assert.equal(signedIn.statusCode, 200);
        assert.equal(signedIn.headers['cache-control'], 's-maxage=12, stale-while-revalidate=10');
        assert.equal('villageIntel' in (signedIn.body ?? {}), false);

        const anonymous = await get(null);
        assert.equal(anonymous.headers['cache-control'], 's-maxage=12, stale-while-revalidate=10');
        // Identical document for both callers — that is what makes it shareable.
        assert.equal(signedIn.headers['etag'], anonymous.headers['etag']);
        assert.deepEqual(signedIn.body, anonymous.body);
    });

    it('keeps the ETag stable across a sector-pool change, so the 304 path still fires', async () => {
        const first = await get(null);
        const etag = first.headers['etag'];
        assert.ok(etag);
        assert.deepEqual(first.body?.sectorPools, {});

        // Somebody explores: the volatile slice moves, the ETag must not.
        await kv.set(`world:sector-pool:12:${TODAY}`, { explores: 7, chests: 1 });
        const second = await get(null);
        assert.deepEqual(second.body?.sectorPools, { 12: { explores: 7, chests: 1 } });
        assert.equal(second.headers['etag'], etag);

        // …and a conditional poll gets the empty 304 instead of the full map.
        const conditional = await get(null, etag);
        assert.equal(conditional.statusCode, 304);
        assert.equal(conditional.ended, true);
        assert.equal(conditional.body, undefined);
    });

    it('still moves the ETag when the non-volatile slice actually changes', async () => {
        const before = (await get(null)).headers['etag'];
        await kv.set('world:territory:12', { sector: 12, ownerVillage: 'Moonshadow Village' });
        const after = await get(null);
        assert.notEqual(after.headers['etag'], before);
        assert.equal((await get(null, after.headers['etag'])).statusCode, 304);
    });

    it('drops the sector-pool scan entirely when Village Stores is switched off', async () => {
        await kv.set(`world:sector-pool:12:${TODAY}`, { explores: 7, chests: 1 });
        process.env.DISABLE_VILLAGE_STORES = '1';
        const out = await get(null);
        assert.deepEqual(out.body?.sectorPools, {});
        assert.equal(out.headers['cache-control'], 's-maxage=12, stale-while-revalidate=10');
    });
});
