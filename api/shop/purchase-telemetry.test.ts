import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'shop-premium-telemetry-isolated-test-secret';

/*
 * I-19 (2026-10 economy rebalance): the Quartermaster / Marketplace purchase,
 * the bloodline forge and the paid awakening reroll record their sink once, after
 * the commit, and a replayed request (same requestId / actionId, or a resumed
 * entitlement) records nothing.
 */

type Json = Record<string, unknown>;
type LoggedTxn = { txnId: string; player: string; currency: string; delta: number; source: string };
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let drainBackgroundWork: typeof import('../_background-work.js').drainBackgroundWork;
let purchase: Handler;
let forge: Handler;
let awaken: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    purchase = (await import('./purchase.js')).default as unknown as Handler;
    forge = (await import('../bloodlines/forge.js')).default as unknown as Handler;
    awaken = (await import('../awakening/roll.js')).default as unknown as Handler;
});

async function call(endpoint: Handler, player: string, body: Json) {
    const output = { status: 200, body: {} as Json };
    const res = { setHeader: () => res, status: (status: number) => { output.status = status; return res; },
        json: (value: Json) => { output.body = value; return res; }, end: () => res };
    await endpoint({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-token': issuePlayerToken(player) }, socket: { remoteAddress: '203.0.113.141' } } as never, res as never);
    return output;
}

async function seed(player: string, character: Json) {
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, level: 10, inventory: [], itemStacks: [], ...character } });
}

async function txns(player: string) {
    await drainBackgroundWork();
    return ((await kv.get<LoggedTxn[]>('econ:txns')) ?? [])
        .filter((txn) => txn.player === player)
        .map(({ txnId, currency, delta, source }) => ({ txnId, currency, delta, source }));
}

test('a shop purchase logs its server-priced sink once; the replay logs nothing', async () => {
    const player = 'shoptelemetry1';
    await seed(player, { ryo: 5000 });
    const body = { requestId: 'shop-telemetry-0001', itemId: 'shinobi-vest', qty: 1 };
    const first = await call(purchase, player, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const paid = (first.body.purchase as { totalCost: number }).totalCost;
    assert.ok(paid > 0);
    const replay = await call(purchase, player, body);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(await txns(player), [
        { txnId: `shop.purchase:${player}:shop-telemetry-0001`, currency: 'ryo', delta: -paid, source: 'shop.purchase' },
    ]);
});

test('a refused shop purchase logs nothing', async () => {
    const player = 'shoptelemetry2';
    await seed(player, { level: 10, fateShards: 1000 });
    const refused = await call(purchase, player, { requestId: 'shop-telemetry-0002', itemId: 'worldsplitter-katana', qty: 1 });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'level-required');
    assert.deepEqual(await txns(player), []);
});

test('a bloodline forge logs the material it debits; resuming the paid entitlement logs nothing', async () => {
    const player = 'forgetelemetry1';
    await seed(player, { boneCharms: 250 });
    const first = await call(forge, player, { rank: 'B Rank' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.cost, 200);
    const resumed = await call(forge, player, { rank: 'B Rank', resumeOnly: true });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.resumed, true);
    const logged = await txns(player);
    assert.equal(logged.length, 1);
    assert.match(logged[0]!.txnId, new RegExp(`^bloodline-forge:${player}:\\d+$`));
    assert.deepEqual({ currency: logged[0]!.currency, delta: logged[0]!.delta, source: logged[0]!.source }, { currency: 'boneCharms', delta: -200, source: 'bloodline.forge' });
});

test('a paid awakening reroll logs its Fate Shards once; the replay logs nothing', async () => {
    const player = 'awakentelemetry1';
    await seed(player, { level: 20, fateShards: 30, elements: ['Fire', 'Earth'], element: 'Fire' });
    const paid = await call(awaken, player, { kind: 'paid-single', actionId: 'awaken_telemetry_1' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const replay = await call(awaken, player, { kind: 'paid-single', actionId: 'awaken_telemetry_1' });
    assert.equal(replay.body.alreadyApplied, true);
    assert.deepEqual(await txns(player), [
        { txnId: `awakening:${player}:awaken_telemetry_1`, currency: 'fateShards', delta: -10, source: 'awakening.reroll' },
    ]);
});
