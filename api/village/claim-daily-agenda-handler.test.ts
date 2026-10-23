import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;

/*
 * /api/village/claim-daily-agenda on the real handler and storage adapter, for
 * the two 2026-10 rebalance fixes it carries:
 *  - I-10: the agenda's "control" task counts the WAR sectors the village holds
 *    (api/_war-held-sectors.ts), not every territory row stamped with its name;
 *  - I-11: the claim assesses the day's occupation tax on the server, so a
 *    client that never calls /api/village/tax is still taxed.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body?: Record<string, any> };

const PLAYER = 'agendaclaimer';
const SAVE_KEY = `save:${PLAYER}`;
const VILLAGE = 'Frostfang Village';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let handler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    handler = (await import('./claim-daily-agenda.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    // Another village holds a war sector, so the territory table reads as
    // seeded (an unseeded table falls back to every village's home baseline).
    await kv.set('world:territory:1', { ownerVillage: 'Stormveil Village' });
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village: VILLAGE, level: 40, ryo: 1_000, bankRyo: 0, honorSeals: 0, boneCharms: 0 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function holdUtcDay(t: TestContext): void {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
}

async function claim(): Promise<Out> {
    const out: Out = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (payload: Record<string, any>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, village: VILLAGE },
        headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

describe('the agenda control task counts held WAR sectors only', { concurrency: false }, () => {
    test('a stray stamp on a wilderness sector does not complete it', async (t) => {
        holdUtcDay(t);
        await kv.set('world:territory:70', { ownerVillage: VILLAGE });
        const out = await claim();
        assert.equal(out.status, 403, JSON.stringify(out.body));
        assert.equal((await kv.get<Record<string, any>>(SAVE_KEY))?.character.ryo, 1_000, 'nothing was paid');
    });

    test('a held war sector completes it', async (t) => {
        holdUtcDay(t);
        await kv.set('world:territory:26', { ownerVillage: VILLAGE });
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.personalAlreadyClaimed, false);
    });

    test('a failed territory scan answers 503 and pays nothing', async (t) => {
        holdUtcDay(t);
        await kv.set('world:territory:26', { ownerVillage: VILLAGE });
        const keys = kv.keys.bind(kv);
        t.mock.method(kv, 'keys', async (pattern: string) => {
            if (pattern === 'world:territory:*') throw new Error('injected: territory scan failed');
            return keys(pattern);
        });
        const out = await claim();
        assert.equal(out.status, 503);
        assert.equal((await kv.get<Record<string, any>>(SAVE_KEY))?._saveVersion, 1, 'nothing was written');
    });
});

describe('the agenda claim assesses the occupation tax', { concurrency: false }, () => {
    test('a conqueror is taxed once by the claim, and the reply echoes the post-tax balances', async (t) => {
        holdUtcDay(t);
        for (const sector of [26, 27, 28, 29, 30, 31, 32, 33, 2]) await kv.set(`world:territory:${sector}`, { ownerVillage: VILLAGE });
        await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village: VILLAGE, level: 40, ryo: 500_000, bankRyo: 0, honorSeals: 0, boneCharms: 0 } });
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.villageTax?.applied, true);
        assert.equal(out.body?.villageTax?.taxed, 4_950);
        assert.equal(out.body?.villageTax?.ryo, 500_000 - 4_950);
        const saved = (await kv.get<Record<string, any>>(SAVE_KEY))!;
        assert.equal(saved.character.ryo, 500_000 - 4_950 + Number(out.body?.personal?.granted?.ryo ?? 0));
        assert.equal(saved.character.lastTaxDate, new Date().toISOString().slice(0, 10));
        // The same day again: nothing is assessed.
        resetRateLimits();
        const again = await claim();
        assert.equal(again.status, 200);
        assert.equal(again.body?.villageTax, undefined);
    });
});
