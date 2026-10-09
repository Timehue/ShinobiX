import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-war-map-test-secret-32-bytes-long';
process.env.ADMIN_PASSWORD = 'village-war-map-test-admin';

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
    delete process.env.ADMIN_PASSWORD;
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

    it('resolves the viewer\'s village from the save\'s village alone, never the whole save', async () => {
        await seedSave('frostrunner', VIEWER);

        const store = kv as unknown as Record<string, unknown>;
        const originalGet = kv.get.bind(kv);
        const originalMget = kv.mget.bind(kv);
        let fullSaveReads = 0;
        const projected: string[][] = [];
        store.get = ((key: string, ...rest: unknown[]) => {
            if (String(key).startsWith('save:')) fullSaveReads++;
            return (originalGet as (...a: unknown[]) => unknown)(key, ...rest);
        }) as typeof kv.get;
        store.mget = ((...keys: string[]) => {
            fullSaveReads += keys.filter((key) => String(key).startsWith('save:')).length;
            return (originalMget as (...a: unknown[]) => unknown)(...keys);
        }) as typeof kv.mget;
        store.mgetProjected = async (keys: string[], projection: Record<string, readonly string[]>) => {
            projected.push(keys);
            const { projectKvValue } = await import('../_storage-projection.js');
            return (await originalMget(...keys)).map((value) => projectKvValue(value, projection));
        };
        let out: ResponseOut;
        try {
            out = await get('frostrunner');
        } finally {
            store.get = originalGet;
            store.mget = originalMget;
            delete store.mgetProjected;
        }
        assert.equal(out.statusCode, 200);
        assert.equal(fullSaveReads, 0, 'one short string must not cost the whole save blob');
        assert.deepEqual(projected, [['save:frostrunner']]);
        assert.ok(Array.isArray(out.body?.villages));
    });

    it('a village claimed in the presence row does not unlock that village\'s internals', async () => {
        // Presence `character` is client-supplied: whatever the heartbeat sent.
        // Trusted here, a player who claimed Moonshadow got Moonshadow's war
        // chest, structures and stores.
        await seedSave('frostrunner', VIEWER);
        await kv.set('shared:village-war:moonshadowvillage', { warResources: 910, structures: { watchtower: 3 } });
        onlineStore.upsert({ name: 'frostrunner', sector: 26, character: { name: 'frostrunner', village: 'Moonshadow Village', level: 20 } });

        const out = await get('frostrunner');
        assert.equal(out.statusCode, 200);
        const villages = out.body?.villages as Array<Record<string, unknown>>;
        const moon = villages.find((v) => v.village === 'Moonshadow Village')!;
        const own = villages.find((v) => v.village === VIEWER)!;
        assert.equal(moon.restricted, true, 'the save, not presence, says which village is theirs');
        assert.equal('warResources' in moon, false);
        assert.equal(own.restricted, undefined);
    });

    it('shows the held count the daily pass pays: war sectors only, suspended ones excluded', async () => {
        // Every central, special or wilderness row stamped with a village used to
        // count, and the screen showed suspended sectors the faucet did not pay.
        await seedSave('frostrunner', VIEWER);
        for (const sector of [26, 27, 28, 29, 30, 31, 32, 33]) await kv.set(`world:territory:${sector}`, { sector, ownerVillage: VIEWER });
        for (const sector of [25, 40, 47, 99]) await kv.set(`world:territory:${sector}`, { sector, ownerVillage: VIEWER });
        await kv.set('world:territory:27', { sector: 27, ownerVillage: VIEWER, ownerClan: 'Frost', rewardSuspendedAt: Date.now() - 1 });
        const out = await get('frostrunner');
        assert.equal(out.statusCode, 200);
        const frost = (out.body?.villages as Array<{ village: string; sectorsHeld: number }>).find((v) => v.village === VIEWER);
        assert.equal(frost?.sectorsHeld, 7);
    });

    it('shows a village\'s war chest, structures and stores to its own members only', async () => {
        // Owner ruling 2026-10-08: village internals are for that village's
        // members; everyone else sees who holds what and each sector's rules.
        const internals = ['warResources', 'treasurySeals', 'structures', 'upkeepWr', 'dormant', 'wrPerSector', 'taxRatePct', 'provisions', 'materialPoints', 'depotConversionCap', 'storesLedger'];
        await seedSave('frostrunner', VIEWER);
        await kv.set('shared:village-war:frostfangvillage', { warResources: 640, structures: { ramparts: 2 } });
        await kv.set('shared:village-war:moonshadowvillage', { warResources: 910, structures: { watchtower: 3 } });
        await kv.set('game:village-state:moonshadowvillage', { treasury: { honorSeals: 77, provisions: 300, materialPoints: 40 } });

        const member = await get('frostrunner');
        assert.equal(member.statusCode, 200);
        const villages = member.body?.villages as Array<Record<string, unknown>>;
        const own = villages.find((v) => v.village === VIEWER)!;
        const moon = villages.find((v) => v.village === 'Moonshadow Village')!;
        assert.equal(own.restricted, undefined);
        assert.equal(own.warResources, 640, 'a member sees their own war chest');
        assert.equal(moon.restricted, true);
        for (const field of internals) assert.equal(field in moon, false, `another village's ${field} is hidden`);
        assert.ok(Array.isArray(moon.sectors), 'the rules of the sectors it holds stay public');
        assert.equal(typeof moon.sectorsHeld, 'number');

        const { res, out } = fakeRes();
        await warMap({ method: 'GET', headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' } } as never, res);
        assert.equal(out.statusCode, 200);
        const adminMoon = (out.body?.villages as Array<Record<string, unknown>>).find((v) => v.village === 'Moonshadow Village')!;
        assert.equal(adminMoon.warResources, 910, 'an admin sees every village');
        assert.equal(adminMoon.treasurySeals, 77);
    });
});
