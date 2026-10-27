import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'war-mission-admin';
delete process.env.SESSION_SECRET;

/*
 * POST /api/village/war-mission pays the mission and mints the single-use
 * war-damage token the world-state write spends for the mission's 30 war HP.
 *
 * The token used to be minted AFTER the mission committed, and a failed mint
 * was swallowed: the reward was paid and spent (a retry is refused as
 * out-of-order) while the war HP was lost for good. It is now minted inside
 * the decision, before the write. A mint that fails fails the claim with
 * nothing committed, so the retry is a fresh claim; a token whose mission did
 * not commit is deleted again; and a write that may have landed keeps it.
 */

type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };

const FIXED_NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const TODAY = '2026-10-20';
const PREFIX = 'warmissionqa';
const TOKEN_PREFIX = 'war:mission-token:';

let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let PET_BREEDING_MIGRATION_VERSION: number;
let RAIDS_PER_MISSION: number;

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    ({ VILLAGE_WAR_RAIDS_PER_MISSION: RAIDS_PER_MISSION } = await import('./_war-mission.js'));
    handler = (await import('./war-mission.js')).default as unknown as typeof handler;
});

async function cleanup() {
    for (const pattern of [`*${PREFIX}*`, `${TOKEN_PREFIX}*`, 'lock:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
}
beforeEach(cleanup);
after(async () => {
    await cleanup();
    mock.timers.reset();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

async function seed(name: string) {
    await kv.set(`save:${name}`, {
        _saveVersion: 5, _saveAt: FIXED_NOW, _regenAt: FIXED_NOW,
        character: {
            name, level: 40, village: 'Ashen', pets: [], inventory: [], petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            hp: 900, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, ryo: 5_000,
            villageWarMissionDate: TODAY, villageWarRaidProgress: RAIDS_PER_MISSION, villageWarMissionsCompleted: 0,
            clanMissionContrib: 0, totalMissionsCompleted: 0,
        },
    });
}

async function claim(name: string): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName: name, missionIndex: 0 },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.97' },
        socket: { remoteAddress: '127.0.0.97' },
    } as never, res as never);
    return out;
}

const completedOf = async (name: string) =>
    Number(((await kv.get<{ character: Json }>(`save:${name}`))!.character).villageWarMissionsCompleted);
const tokenKeys = () => kv.keys(`${TOKEN_PREFIX}*`);

type Store = {
    set: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
    compareSet: (key: string, expected: unknown, value: unknown, options?: unknown) => Promise<boolean>;
    get: (key: string) => Promise<unknown>;
};

describe('village war mission and its war-damage token', { concurrency: false }, () => {
    it('hands a spendable token to the player who is paid', async () => {
        const name = `${PREFIX}ok`;
        await seed(name);
        const out = await claim(name);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(await completedOf(name), 1);
        const tokenId = String(out.body?.warMissionToken ?? '');
        assert.ok(tokenId, 'a token rode back with the payout');
        const token = await kv.get<Json>(`${TOKEN_PREFIX}${tokenId}`);
        assert.equal(token?.damage, 30);
        assert.equal(token?.playerName, name);
        assert.equal(token?.village, 'Ashen');
    });

    it('a mint that fails fails the claim with nothing committed, so the retry still earns the war damage', async () => {
        const name = `${PREFIX}mintfail`;
        await seed(name);
        const store = kv as unknown as Store;
        const originalSet = store.set;
        store.set = async (key, value, options) => {
            if (key.startsWith(TOKEN_PREFIX)) throw new Error('token store down');
            return originalSet.call(kv, key, value, options);
        };
        let failed: Out;
        try { failed = await claim(name); } finally { store.set = originalSet; }
        assert.equal(failed.statusCode, 500);
        assert.equal(await completedOf(name), 0, 'the mission was not spent');

        const retry = await claim(name);
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(await completedOf(name), 1);
        assert.ok(retry.body?.warMissionToken, 'the retry carries the war damage');
    });

    it('a write that fails without landing deletes the minted token, and the retry mints its own', async () => {
        const name = `${PREFIX}notlanded`;
        await seed(name);
        const store = kv as unknown as Store;
        const originalCas = store.compareSet;
        store.compareSet = async () => { throw new Error('socket hang up'); };
        let failed: Out;
        try { failed = await claim(name); } finally { store.compareSet = originalCas; }
        assert.equal(failed.statusCode, 500);
        assert.equal(await completedOf(name), 0);
        assert.deepEqual(await tokenKeys(), [], 'no token is left for a mission that was not paid');

        const retry = await claim(name);
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal((await tokenKeys()).length, 1);
    });

    it('a write that landed but cannot be read back keeps the token, so the paid mission is not left without its damage', async () => {
        const name = `${PREFIX}landed`;
        await seed(name);
        const store = kv as unknown as Store;
        const originalCas = store.compareSet;
        const originalGet = store.get;
        let armed = true;
        let unreadable = false;
        store.compareSet = async (key, expected, value, options) => {
            const landed = await originalCas.call(kv, key, expected, value, options);
            if (armed && key === `save:${name}`) { armed = false; unreadable = true; throw new Error('ack lost'); }
            return landed;
        };
        store.get = async (key) => {
            if (unreadable && key === `save:${name}`) { unreadable = false; throw new Error('read-back down'); }
            return originalGet.call(kv, key);
        };
        let first: Out;
        try { first = await claim(name); } finally { store.compareSet = originalCas; store.get = originalGet; }
        assert.equal(first.statusCode, 500);
        assert.equal(await completedOf(name), 1, 'the write did land');
        assert.equal((await tokenKeys()).length, 1, 'its token is kept, never double-granted and never lost');
        assert.equal((await claim(name)).statusCode, 409, 'the mission cannot be claimed again');
    });
});
