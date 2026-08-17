import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-authority-race-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const SECTOR = 23;
const ATTACKER_SECTOR = 24;
const ATTACKER = 'Moonshadow Village';
const OLD_DEFENDER = 'Frostfang Village';
const NEW_DEFENDER = 'Stormveil Village';
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const ATTACKER_TERRITORY_KEY = `world:territory:${ATTACKER_SECTOR}`;
const ATTACKER_WR_KEY = 'shared:village-war:moonshadowvillage';
const OLD_CONTEST_KEY = 'shared:sector-war:23:moonshadowvillage-vs-frostfangvillage';
const NEW_CONTEST_KEY = 'shared:sector-war:23:moonshadowvillage-vs-stormveilvillage';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const loaded = await import('./sector-war.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default
        ?? loaded.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: OLD_DEFENDER, hp: 20_000, updatedAt: Date.now() });
    await kv.set(ATTACKER_TERRITORY_KEY, { sector: ATTACKER_SECTOR, ownerVillage: ATTACKER, hp: 20_000, updatedAt: Date.now() });
    await kv.set(ATTACKER_WR_KEY, { warResources: 1_000, structures: {}, sectors: {} });
    await kv.set('shared:village-war:frostfangvillage', { warResources: 1_000, structures: {}, sectors: {} });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function declare(): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body: { action: 'declare', playerName: 'authorityraceadmin', village: ATTACKER, sector: SECTOR },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('sector-war declaration territory authority race', { concurrency: false }, () => {
    it('rebinds owner inside the publication lock and refuses a stale defender without debit or contest', async () => {
        const originalGet = kv.get.bind(kv);
        let territoryReads = 0;
        kv.get = (async <T>(key: string) => {
            if (key === TERRITORY_KEY) {
                territoryReads += 1;
                if (territoryReads === 2) {
                    // Deterministic interleave: the first admission read sealed
                    // Frostfang, then the authoritative row flips before the
                    // declaration's locked publication-time read.
                    await kv.set(TERRITORY_KEY, {
                        sector: SECTOR,
                        ownerVillage: NEW_DEFENDER,
                        hp: 20_000,
                        updatedAt: Date.now(),
                    });
                }
            }
            return originalGet<T>(key);
        }) as typeof kv.get;

        let response: ResponseOut;
        try {
            response = await declare();
        } finally {
            kv.get = originalGet as typeof kv.get;
        }

        assert.ok(territoryReads >= 2, 'the route must re-read territory authority at publication');
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body?.error), /changed owners/i);
        assert.equal((await kv.get<{ warResources?: number }>(ATTACKER_WR_KEY))?.warResources, 1_000);
        assert.equal(await kv.get(OLD_CONTEST_KEY), null);
        assert.equal(await kv.get(NEW_CONTEST_KEY), null);
        const reservationKeys = await kv.keys('world:village-war-reservation:*');
        for (const key of reservationKeys) {
            const row = await kv.get<{ status?: string }>(key);
            assert.notEqual(row?.status, 'reserved', `${key} must not retain a live reservation`);
        }
    });
});
