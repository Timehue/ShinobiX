import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'village-intel-test-admin';
process.env.SESSION_SECRET = 'village-intel-test-secret-32-bytes-long';

/*
 * GET /api/village/intel — the per-viewer Village Stores intel block, moved OFF
 * the shared world-state GET so that poll can stay publicly CDN-cacheable.
 *
 * Covers the endpoint contract: auth required, kill switch → an explicit empty
 * block (not a 404), reveals gated at the 100-point `scouted` threshold, and
 * `scoutedBy` only on sectors the viewer's village actually OWNS.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown>; headers: Record<string, string> };

const VIEWER = 'Moonshadow Village';
const RIVAL = 'Frostfang Village';

let intel: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let clearProcCache: () => void;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __clearProcCache: clearProcCache } = await import('../_proc-cache.js'));
    intel = (await import('./intel.js')).default as unknown as Handler;
});
beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.DISABLE_VILLAGE_STORES;
    clearProcCache();
});
after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_VILLAGE_STORES;
    clearProcCache();
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

/** `playerName: null` = an unauthenticated caller (no headers at all). */
async function get(playerName: string | null, method = 'GET'): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const headers: Record<string, string> = {};
    if (playerName) {
        headers['x-player-name'] = playerName;
        headers['x-player-token'] = issuePlayerToken(playerName) ?? '';
    }
    await intel({ method, headers, socket: { remoteAddress: '127.0.0.1' } } as never, res);
    return out;
}

async function seedPlayer(name: string, village: string) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 20, ryo: 0, stats: {}, jutsu: [], equipment: {}, inventory: [], itemStacks: [] } });
}
async function seedIntel(village: string, sectors: Record<number, number>, now = Date.now()) {
    const slug = village.toLowerCase().replace(/[^a-z0-9]/g, '');
    await kv.set(`village:intel:${slug}`, {
        village,
        sectors: Object.fromEntries(Object.entries(sectors).map(([s, points]) => [s, { points, lastAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000 }])),
    });
}

describe('GET /api/village/intel', { concurrency: false }, () => {
    it('requires authentication, refuses non-GET, and never lets a shared cache hold the block', async () => {
        assert.equal((await get(null)).statusCode, 401);
        assert.equal((await get('nobody', 'POST')).statusCode, 405);
        await seedPlayer('moonrunner', VIEWER);
        const ok = await get('moonrunner');
        assert.equal(ok.statusCode, 200);
        assert.equal(ok.headers['cache-control'], 'private, no-store');
    });

    it('kill switch OFF → an explicit empty block, not a 404 and not a reveal', async () => {
        process.env.DISABLE_VILLAGE_STORES = '1';
        await seedPlayer('moonrunner', VIEWER);
        await seedIntel(VIEWER, { 12: 900 });
        const out = await get('moonrunner');
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.enabled, false);
        assert.equal(out.body?.villageIntel, null);
    });

    it('a caller with no village (admin / villageless save) gets an enabled but empty block', async () => {
        await seedPlayer('drifter', '');
        await seedIntel(VIEWER, { 12: 900 });
        const out = await get('drifter');
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.enabled, true);
        assert.equal(out.body?.villageIntel, null);
    });

    it('reveals ONLY sectors at >= 100 points, with the garrison / pool / structure block', async () => {
        await seedPlayer('moonrunner', VIEWER);
        await seedIntel(VIEWER, { 12: 140, 5: 99, 20: 600 });
        await kv.set('world:territory:12', { sector: 12, ownerVillage: RIVAL });
        await kv.set(`world:sector-pool:12:${new Date().toISOString().slice(0, 10)}`, { explores: 120, chests: 3 });
        await kv.set('shared:village-war:frostfangvillage', { village: RIVAL, structures: { ramparts: 2, supplyDepot: 4 } });

        const out = await get('moonrunner');
        const view = out.body?.villageIntel as {
            village: string;
            thresholds: Record<string, number>;
            revealed: Array<{ sector: number; tier: string; revealed: { garrison: string; poolUsage: { explores: number; chests: number }; structures: Record<string, number> | null } }>;
            scoutedBy: Record<string, unknown[]>;
        };
        assert.equal(view.village, VIEWER);
        assert.equal(view.thresholds.scouted, 100);
        assert.deepEqual(view.revealed.map((r) => r.sector), [12, 20]); // 5 is under the threshold
        const twelve = view.revealed.find((r) => r.sector === 12)!;
        assert.equal(twelve.tier, 'scouted');
        assert.equal(twelve.revealed.garrison, 'none'); // no live contest
        assert.deepEqual(twelve.revealed.poolUsage, { explores: 120, chests: 3 });
        assert.equal(twelve.revealed.structures?.supplyDepot, 4);
        // An unowned sector reveals no defender structures.
        assert.equal(view.revealed.find((r) => r.sector === 20)!.revealed.structures, null);
    });

    it('scoutedBy lists rivals ONLY on sectors the viewer village owns, and never leaks the rival view', async () => {
        await seedPlayer('moonrunner', VIEWER);
        await seedPlayer('frostrunner', RIVAL);
        await kv.set('world:territory:33', { sector: 33, ownerVillage: VIEWER });
        await kv.set('world:territory:44', { sector: 44, ownerVillage: RIVAL });
        await seedIntel(RIVAL, { 33: 300, 44: 800 });

        const mine = await get('moonrunner');
        const view = mine.body?.villageIntel as { revealed: unknown[]; scoutedBy: Record<string, Array<{ village: string; tier: string }>> };
        assert.deepEqual(Object.keys(view.scoutedBy), ['33']); // 44 is theirs, not mine
        assert.deepEqual(view.scoutedBy['33'], [{ village: RIVAL, tier: 'mapped', points: 300 }]);
        assert.deepEqual(view.revealed, []); // the viewer scouted nothing itself

        // The rival's own call is built for THEIR village — a per-village memo
        // must not hand one village another's block.
        const theirs = await get('frostrunner');
        const rivalView = theirs.body?.villageIntel as { village: string; revealed: Array<{ sector: number }>; scoutedBy: Record<string, unknown> };
        assert.equal(rivalView.village, RIVAL);
        assert.deepEqual(rivalView.revealed.map((r) => r.sector), [33, 44]);
        assert.deepEqual(rivalView.scoutedBy, {});
    });
});

/*
 * Perf contract: the viewer's village is resolved BEFORE the proc-cache memo, so
 * whatever it costs is paid on EVERY request rather than once per frame. It used
 * to be a full `save:<name>` read — the fattest row in the store (base64 avatar,
 * inventory, jutsu) — for one short string. It now comes from the in-memory
 * presence row, with the save read kept only as the offline fallback.
 */
describe('GET /api/village/intel — village resolution cost', { concurrency: false }, () => {
    it('an ONLINE viewer costs zero save reads, even across a cold proc-cache', async () => {
        const { onlineStore } = await import('../_realtime/online-store.js');
        await seedPlayer('moonrunner', VIEWER);
        await seedIntel(VIEWER, { 12: 900 });
        onlineStore.upsert({ name: 'moonrunner', sector: 12, character: { name: 'moonrunner', village: VIEWER, level: 20 } });

        const original = kv.get.bind(kv);
        let saveReads = 0;
        (kv as unknown as { get: typeof kv.get }).get = ((key: string, ...rest: unknown[]) => {
            if (String(key).startsWith('save:')) saveReads++;
            return (original as (...a: unknown[]) => unknown)(key, ...rest);
        }) as typeof kv.get;
        try {
            const first = await get('moonrunner');
            const second = await get('moonrunner'); // warm memo — must also be free
            assert.equal(first.statusCode, 200);
            assert.equal((first.body?.villageIntel as { village: string }).village, VIEWER);
            assert.equal((second.body?.villageIntel as { village: string }).village, VIEWER);
        } finally {
            (kv as unknown as { get: typeof kv.get }).get = original;
            onlineStore.remove('moonrunner');
        }
        assert.equal(saveReads, 0, 'the hot per-request path must not read a save blob');
    });

    it('an OFFLINE viewer still resolves, via the save fallback', async () => {
        await seedPlayer('moonrunner', VIEWER);
        await seedIntel(VIEWER, { 12: 900 });
        const out = await get('moonrunner');
        assert.equal(out.statusCode, 200);
        assert.equal((out.body?.villageIntel as { village: string }).village, VIEWER);
    });

    it('presence cannot be used to read ANOTHER village\'s scoutedBy block', async () => {
        // Presence character is client-supplied, so a viewer could claim any
        // village. The block they get back is still only that village's PUBLIC
        // map layer — it grants nothing and writes nothing. Locked in so a future
        // change can't quietly start paying out from this resolve.
        const { onlineStore } = await import('../_realtime/online-store.js');
        await seedPlayer('moonrunner', VIEWER);
        await kv.set('world:territory:33', { sector: 33, ownerVillage: RIVAL });
        await seedIntel(VIEWER, { 33: 300 });
        onlineStore.upsert({ name: 'moonrunner', sector: 12, character: { name: 'moonrunner', village: RIVAL } });
        try {
            const out = await get('moonrunner');
            const view = out.body?.villageIntel as { village: string; revealed: unknown[]; scoutedBy: Record<string, unknown[]> };
            assert.equal(view.village, RIVAL);
            assert.deepEqual(view.revealed, []);                    // Moonshadow's intel is NOT handed over
            assert.deepEqual(view.scoutedBy['33'], [{ village: VIEWER, tier: 'mapped', points: 300 }]);
        } finally {
            onlineStore.remove('moonrunner');
        }
    });
});
