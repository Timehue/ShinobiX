import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-war-map-test-secret-32-bytes-long';

/*
 * GET /api/village/war-map — the read-only WR-economy aggregator.
 *
 * These cover the two things that make this endpoint expensive or unsafe at the
 * 100-200 concurrent cap rather than its view math (which api/_war-map-view.test.ts
 * already owns):
 *   1. The response is PER-VIEWER (`projectSectorWarForClient(c, viewerVillage)`)
 *      and previously set no Cache-Control at all, leaving it eligible for the
 *      shared CDN cache that server.ts notes fronts some GETs.
 *   2. Resolving that viewer village used to read the caller's whole `save:` row —
 *      base64 avatar and inventory included — for one short string, on every poll.
 */

const VIEWER = 'Frostfang Village';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown>; headers: Record<string, string> };

let warMap: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    warMap = (await import('./war-map.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    delete process.env.DISABLE_VILLAGE_WAR_MAP;
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, headers: {} };
    const res = {
        setHeader: (k: string, v: string) => { out.headers[String(k).toLowerCase()] = String(v); return res; },
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function get(playerName: string | null, method = 'GET'): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const headers: Record<string, string> = {};
    if (playerName) {
        headers['x-player-name'] = playerName;
        headers['x-player-token'] = issuePlayerToken(playerName) ?? '';
    }
    await warMap({ method, headers, socket: { remoteAddress: '127.0.0.1' } } as never, res);
    return out;
}

async function seedSave(name: string, village: string) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 20, ryo: 0, stats: {}, jutsu: [], equipment: {}, inventory: [], itemStacks: [] } });
}

describe('GET /api/village/war-map', { concurrency: false }, () => {
    it('requires auth, refuses non-GET, and marks the per-viewer body private/no-store', async () => {
        assert.equal((await get(null)).statusCode, 401);
        assert.equal((await get('frostrunner', 'POST')).statusCode, 405);

        await seedSave('frostrunner', VIEWER);
        const ok = await get('frostrunner');
        assert.equal(ok.statusCode, 200);
        assert.equal(ok.body?.ok, true);
        assert.equal(
            ok.headers['cache-control'],
            'private, no-store',
            'the body carries the CALLER\'s garrison-feed mirror — a shared cache must never hold it',
        );
    });

    it('sets the no-store header before auth, so even the 401 body is unshareable', async () => {
        // Ordered exactly like /api/village/intel: the header lands ahead of the
        // auth check (which can 401 with a body) and after the method check
        // (which 405s with no body at all).
        assert.equal((await get(null)).headers['cache-control'], 'private, no-store');
    });

    it('an ONLINE viewer costs ZERO save reads to resolve their village', async () => {
        await seedSave('frostrunner', VIEWER);
        onlineStore.upsert({ name: 'frostrunner', sector: 26, character: { name: 'frostrunner', village: VIEWER, level: 20 } });

        const original = kv.get.bind(kv);
        let saveReads = 0;
        (kv as unknown as { get: typeof kv.get }).get = ((key: string, ...rest: unknown[]) => {
            if (String(key).startsWith('save:')) saveReads++;
            return (original as (...a: unknown[]) => unknown)(key, ...rest);
        }) as typeof kv.get;
        let out: ResponseOut;
        try {
            out = await get('frostrunner');
        } finally {
            (kv as unknown as { get: typeof kv.get }).get = original;
        }
        assert.equal(out.statusCode, 200);
        assert.equal(saveReads, 0, 'presence already carries `village`; the save blob must not be read');
        assert.ok(Array.isArray(out.body?.villages));
    });

    it('an OFFLINE viewer still resolves through the save fallback', async () => {
        await seedSave('frostrunner', VIEWER);
        const out = await get('frostrunner');
        assert.equal(out.statusCode, 200);
        assert.ok(Array.isArray(out.body?.villages));
        assert.ok((out.body?.villages as unknown[]).length > 0);
    });
});
