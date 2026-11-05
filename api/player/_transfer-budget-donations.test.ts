import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'transfer-budget-donations-test-secret-32b';

/*
 * Treasury donations and the restricted transfer tier (owner ruling
 * 2026-11-04). A clan or village treasury is a pool an officer can gift out at
 * the TRUSTED ceiling, so an uncapped donation let guest alts launder through
 * it past the 25k-a-day restricted tier. A restricted donor now shares its
 * trade budget with its donations; a trusted donor is neither checked nor
 * charged.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;
let budget: typeof import('./_transfer-budget.js');
let clanDonate: Handler;
let villageDonate: Handler;

const CLAN_KEY = 'save:clan-mist';
const VILLAGE_KEY = 'game:village-state:leaf';
const HOUR = 60 * 60 * 1000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    budget = await import('./_transfer-budget.js');
    clanDonate = (await import('../clan/treasury/donate.js')).default as unknown as Handler;
    villageDonate = (await import('../village/treasury/donate.js')).default as unknown as Handler;
});

/** level 5 is under the PvP newcomer floor; createdAt one hour ago is under 72 h. */
async function seedDonor(name: string, patch: Record<string, unknown>) {
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: { name, clan: 'Mist', village: 'Leaf', level: 40, ryo: 200_000, fateShards: 500, inventory: [], itemStacks: [], ...patch },
    });
}

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(CLAN_KEY, { name: 'Mist', founderName: 'someone', treasury: { ryo: 0, items: [] }, xp: 0, level: 1 });
    await kv.set(VILLAGE_KEY, { village: 'Leaf', treasury: { ryo: 0, items: [] } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET']) delete process.env[key];
});

let ipSeq = 0;
async function donate(handler: Handler, donor: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    ipSeq += 1;
    await handler({
        method: 'POST',
        body: { playerName: donor, clan: 'Mist', village: 'Leaf', ...body },
        headers: { 'x-player-name': donor, 'x-player-token': issuePlayerToken(donor) ?? '' },
        socket: { remoteAddress: `127.0.9.${ipSeq % 250}` },
    } as never, res as never);
    return out;
}

const ryoOf = async (name: string) => Number((await kv.get<{ character: { ryo: number } }>(`save:${name}`))?.character.ryo);
const spentRyo = async (name: string) => budget.sumWindow((await kv.get<{ stamps: unknown }>(budget.transferBudgetKey(name, 'ryo')))?.stamps, Date.now()).spent;

for (const door of [
    { name: 'clan treasury', handler: () => clanDonate },
    { name: 'village treasury', handler: () => villageDonate },
]) {
    describe(`${door.name} donations`, () => {
        it('cap a restricted donor at the trade budget, shared with its trades', async () => {
            await seedDonor('newdonor', { level: 5 });
            const limit = budget.RESTRICTED_OUTBOUND.ryo;
            const first = await donate(door.handler(), 'newdonor', { currency: 'ryo', amount: limit - 5_000 });
            assert.equal(first.statusCode, 200, JSON.stringify(first.body));
            assert.equal(await spentRyo('newdonor'), limit - 5_000, 'the donation is charged to the send budget');

            const over = await donate(door.handler(), 'newdonor', { currency: 'ryo', amount: 6_000 });
            assert.equal(over.statusCode, 429, JSON.stringify(over.body));
            assert.match(String(over.body?.error), /5,000 more ryo/);
            assert.equal(await ryoOf('newdonor'), 200_000 - (limit - 5_000), 'a refused donation moves nothing');
            assert.equal(await spentRyo('newdonor'), limit - 5_000, 'and charges nothing');

            const rest = await donate(door.handler(), 'newdonor', { currency: 'ryo', amount: 5_000 });
            assert.equal(rest.statusCode, 200, JSON.stringify(rest.body));
        });

        it('count a brand-new account as restricted too', async () => {
            await seedDonor('freshdonor', { createdAt: Date.now() - HOUR });
            const over = await donate(door.handler(), 'freshdonor', { currency: 'ryo', amount: budget.RESTRICTED_OUTBOUND.ryo + 1 });
            assert.equal(over.statusCode, 429, JSON.stringify(over.body));
            assert.match(String(over.body?.error), /more ryo/);
        });

        it('leave a trusted donor unchecked and its gift budget untouched', async () => {
            await seedDonor('olddonor', { createdAt: Date.now() - 30 * 24 * HOUR });
            const big = await donate(door.handler(), 'olddonor', { currency: 'ryo', amount: 150_000 });
            assert.equal(big.statusCode, 200, JSON.stringify(big.body));
            assert.equal(await spentRyo('olddonor'), 0);
        });

        it('replay a donation without charging the budget twice', async () => {
            await seedDonor('replaydonor', { level: 5 });
            const body = { currency: 'ryo', amount: 10_000, requestId: 'donation-budget-replay-0001' };
            assert.equal((await donate(door.handler(), 'replaydonor', body)).statusCode, 200);
            const again = await donate(door.handler(), 'replaydonor', body);
            assert.equal(again.statusCode, 200, JSON.stringify(again.body));
            assert.equal(await spentRyo('replaydonor'), 10_000);
        });
    });
}
