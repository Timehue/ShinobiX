import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;

/*
 * The bank routes assess the day's occupation tax on the server (2026-10
 * rebalance, I-11): it used to run only when the client POSTed /api/village/tax,
 * so a modded client never paid it. The assessment runs before the route's own
 * write, so the route moves post-tax balances, and every reply after it, a
 * refusal included, echoes it: its day stamp moved the save version.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body?: Record<string, any> };

const PLAYER = 'taxedbanker';
const SAVE_KEY = `save:${PLAYER}`;
const VILLAGE = 'Frostfang Village';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let transfer: Handler;
let claimInterest: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    transfer = (await import('./transfer.js')).default as unknown as Handler;
    claimInterest = (await import('./claim-interest.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
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

/** Nine held war sectors (1%), a seated Kage, an L40 member holding 500,000 ryo. */
async function seedConqueror(sectors = [26, 27, 28, 29, 30, 31, 32, 33, 2]) {
    for (const sector of sectors) await kv.set(`world:territory:${sector}`, { ownerVillage: VILLAGE });
    await kv.set('world:territory:1', { ownerVillage: 'Stormveil Village' });
    await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village: VILLAGE, level: 40, ryo: 500_000, bankRyo: 0 } });
}

async function call(handler: Handler, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (payload: Record<string, any>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, ...body },
        headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

const saved = async () => (await kv.get<Record<string, any>>(SAVE_KEY))!;

describe('bank routes assess the occupation tax', { concurrency: false }, () => {
    test('a deposit by a conqueror who never called /api/village/tax is taxed once, before the move', async (t) => {
        holdUtcDay(t);
        await seedConqueror();
        const out = await call(transfer, { action: 'deposit', amount: 100_000, requestId: 'tax-hook-deposit-000001' });
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.villageTax?.applied, true);
        assert.equal(out.body?.villageTax?.taxed, 4_950);
        const after = await saved();
        assert.equal(after.character.ryo, 500_000 - 4_950 - 100_000);
        assert.equal(after.character.bankRyo, 100_000);
        assert.equal(out.body?.character?.ryo, after.character.ryo, 'the returned character is post-tax');
        // A second move the same day charges nothing more.
        const again = await call(transfer, { action: 'withdraw', amount: 50_000, requestId: 'tax-hook-withdraw-00001' });
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.equal(again.body?.villageTax, undefined);
        assert.equal((await saved()).character.ryo, 500_000 - 4_950 - 50_000);
    });

    test('a refused transfer still echoes the tax it assessed, with the save version its stamp produced', async (t) => {
        holdUtcDay(t);
        await seedConqueror();
        const out = await call(transfer, { action: 'withdraw', amount: 10_000, requestId: 'tax-hook-refused-00001' });
        assert.ok(out.status >= 400 && out.status < 500, JSON.stringify(out.body));
        assert.equal(out.body?.villageTax?.applied, true);
        const after = await saved();
        assert.equal(after.character.ryo, 500_000 - 4_950);
        assert.equal(out.body?.villageTax?._saveVersion, after._saveVersion, 'the client can adopt the stamped version');
    });

    test('an interest claim is taxed first, so interest is paid on the post-tax vault', async (t) => {
        holdUtcDay(t);
        await seedConqueror();
        const out = await call(claimInterest, {});
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.villageTax?.applied, true);
        assert.equal((await saved()).character.ryo, 500_000 - 4_950);
    });

    test('a village at its eight home sectors is charged nothing, and the day is stamped', async (t) => {
        holdUtcDay(t);
        await seedConqueror([26, 27, 28, 29, 30, 31, 32, 33]);
        const out = await call(transfer, { action: 'deposit', amount: 1_000, requestId: 'tax-hook-peace-0000001' });
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.villageTax?.applied, false);
        const after = await saved();
        assert.equal(after.character.ryo, 499_000);
        assert.equal(after.character.lastTaxDate, new Date().toISOString().slice(0, 10));
    });
});
