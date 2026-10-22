import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// I-19 (2026-10 economy rebalance): a Black Market relic cache pays Bone Charms
// and Aura Stones, and the ledger records both beside the stake.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'black-market-ledger-admin-password';

type Json = Record<string, unknown>;
const PLAYER = 'blackmarketledger';

let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let drainBackgroundWork: typeof import('../_background-work.js').drainBackgroundWork;
let ECON_TXN_LIST_KEY: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    ({ ECON_TXN_LIST_KEY } = await import('../_economy.js'));
    handler = (await import('./black-market.js')).default as unknown as typeof handler;
});

after(async () => {
    await drainBackgroundWork();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

test('a relic-cache pull records its Bone Charms and Aura Stones', async (t) => {
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, ryo: 100_000, boneCharms: 0, auraStones: 0, fateShards: 0 } });
    // 0.9 lands in the relic-cache tier (0.87-0.95): 4 + floor(0.9 x 5) = 8 BC, 2 + floor(0.9 x 3) = 4 AS.
    t.mock.method(Math, 'random', () => 0.9);
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({
        method: 'POST',
        body: { playerName: PLAYER },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        query: {},
        socket: { remoteAddress: '127.0.0.94' },
    } as never, res as never);
    t.mock.restoreAll();
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal((out.body.reward as Json).tier, 'relic');

    await drainBackgroundWork();
    const rows = ((await kv.get<Json[]>(ECON_TXN_LIST_KEY)) ?? [])
        .filter((txn) => txn.player === PLAYER)
        .map((txn) => `${txn.source}:${txn.currency}:${txn.delta}`)
        .sort();
    assert.deepEqual(rows, [
        'blackmarket.payout:auraStones:4',
        'blackmarket.payout:boneCharms:8',
        'blackmarket.stake:ryo:-75000',
    ]);
});
