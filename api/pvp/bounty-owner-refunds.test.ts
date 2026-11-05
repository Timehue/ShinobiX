import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { creditBountyPlacement, normalizeBoard, reserveBountyClaim, restoreBountyClaim, type BountyBoard } from './_bounty.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
let kv: typeof import('../_storage.js').kv;
let refunds: typeof import('./_bounty-deleted-target.js');
let sweep: typeof import('./_bounty-claim.js').sweepPendingBountyClaims;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    refunds = await import('./_bounty-deleted-target.js');
    ({ sweepPendingBountyClaims: sweep } = await import('./_bounty-claim.js'));
});
const KEY = 'pvp:bounties';
const ids = { kaze: '11111111-1111-4111-8111-111111111111', rival: '22222222-2222-4222-8222-222222222222' };
const head = { target: 'Departed', amount: 3_001, contributors: ['kaze', 'rival'], updatedAt: 50 };
const save = (name: string) => ({ _saveVersion: 1, character: { name, ryo: 100 } });
const balance = async (name: string) => (await kv.get<ReturnType<typeof save>>(`save:${name}`))!.character.ryo;
const place = (board: BountyBoard, owner: keyof typeof ids, amount: number, at = 50) => creditBountyPlacement(board, { placer: owner, ownerId: ids[owner], target: 'Departed', amount }, at)!;
async function escrow() {
    const keys = await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`);
    assert.equal(keys.length, 1);
    return (await kv.get<import('./_bounty-deleted-target.js').BountyOwnerRefund>(keys[0]))!;
}
beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const name of ['kaze', 'rival', 'hunter']) await kv.set(`save:${name}`, save(name));
    for (const [name, bountyOwnerId] of Object.entries(ids)) await kv.set(`auth:${name}`, { bountyOwnerId, hash: name, salt: name });
});

test('unproven legacy pools stay separate from the board through retries, normalization and sweeps', async () => {
    await kv.set(KEY, { bounties: [head] });
    const first = await refunds.refundBountyOnDeletedTarget('departed', 100);
    assert.deepEqual(first.refunded, {});
    assert.deepEqual(first.failures, []);
    const board = normalizeBoard(await kv.get(KEY));
    assert.equal(board.bounties.length, 0);
    assert.equal(board.pendingClaims, undefined);
    assert.equal((await escrow()).unresolvedAmount, 3_001);
    await kv.set('save:departed', save('departed'));
    await refunds.refundBountyOnDeletedTarget('departed', 200);
    const swept = await sweep(board, 100_000);
    assert.equal(reserveBountyClaim(swept, 'Departed', { id: 'duel:new-account', winner: 'hunter', at: 100_000 }).ok, false);
    assert.equal((await escrow()).unresolvedAmount, 3_001);
    assert.equal(await balance('kaze'), 100);
    assert.equal(await balance('rival'), 100);
});

test('new placements refund exact original-owner amounts without placement journals', async () => {
    let board: BountyBoard = { bounties: [] };
    for (const [owner, amount] of [['kaze', 2_000], ['rival', 1_000], ['kaze', 500]] as const) board = place(normalizeBoard(board), owner, amount);
    await kv.set(KEY, board);
    assert.deepEqual((await refunds.refundBountyOnDeletedTarget('departed')).refunded, { kaze: 2_500, rival: 1_000 });
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance('kaze'), 2_600);
    assert.equal(await balance('rival'), 1_100);
    assert.ok((await escrow()).entries.every(entry => entry.paidAt !== undefined));
});

test('a proven new contribution to a legacy pool refunds only that contribution', async () => {
    await kv.set(KEY, normalizeBoard(place({ bounties: [head] }, 'kaze', 1_000)));
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance('kaze'), 1_100);
    assert.equal(await balance('rival'), 100);
    assert.equal((await escrow()).unresolvedAmount, 3_001);
});

test('even a single legacy contributor requires account identity proof', async () => {
    await kv.set(KEY, { bounties: [{ ...head, contributors: ['kaze'] }] });
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance('kaze'), 100);
    assert.equal((await escrow()).unresolvedAmount, 3_001);
});

test('missing owner remains held across replacement registration', async () => {
    await kv.set(KEY, place({ bounties: [] }, 'kaze', 2_000));
    await kv.del('save:kaze');
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal((await escrow()).entries[0].hold, 'missing-owner');
    await kv.set('save:kaze', save('kaze'));
    await kv.set('auth:kaze', { bountyOwnerId: ids.rival });
    await refunds.settleBountyOwnerRefunds();
    assert.equal(await balance('kaze'), 100);
    assert.equal((await escrow()).entries[0].claim.head.amount, 2_000);
});

test('restoring and merging an unpaid combat claim preserves account-bound ownership', async () => {
    const reserved = reserveBountyClaim(place({ bounties: [] }, 'kaze', 2_000), 'Departed', { id: 'duel:old', winner: 'missing', at: 60 });
    assert.ok(reserved.ok);
    const board = place(reserved.board, 'rival', 1_000, 70);
    await kv.set(KEY, normalizeBoard(restoreBountyClaim(board, 'duel:old')));
    assert.deepEqual((await refunds.refundBountyOnDeletedTarget('departed')).refunded, { rival: 1_000, kaze: 2_000 });
});

test('normal combat still pays the entire pool to the hunter', async () => {
    const board = place(place({ bounties: [] }, 'kaze', 2_000), 'rival', 1_000);
    const reserved = reserveBountyClaim(board, 'Departed', { id: 'duel:won', winner: 'hunter', at: 70 });
    assert.ok(reserved.ok);
    const swept = await sweep(normalizeBoard(reserved.board), 100_000);
    assert.equal(await balance('hunter'), 3_100);
    assert.equal(await balance('kaze'), 100);
    assert.equal(swept.pendingClaims, undefined);
});

test('failed atomic reservation leaves the full pool live and pays nobody', async () => {
    await kv.set(KEY, place({ bounties: [] }, 'kaze', 2_000));
    const many = kv.compareSetMany;
    kv.compareSetMany = async () => { throw new Error('reservation unavailable'); };
    try { await assert.rejects(refunds.refundBountyOnDeletedTarget('departed'), /reservation unavailable/); }
    finally { kv.compareSetMany = many; }
    assert.equal(normalizeBoard(await kv.get(KEY)).bounties[0].amount, 2_000);
    assert.equal((await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`)).length, 0);
    assert.equal(await balance('kaze'), 100);
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance('kaze'), 2_100);
});

test('failed completion acknowledgement cannot double-pay a refund', async () => {
    await kv.set(KEY, place({ bounties: [] }, 'kaze', 2_000));
    const cas = kv.compareSet.bind(kv);
    kv.compareSet = (async (key, expected, value, ...args) => {
        if (key.startsWith(refunds.BOUNTY_OWNER_REFUND_PREFIX) && expected !== null) throw new Error('completion unavailable');
        return cas(key, expected, value, ...args);
    }) as typeof kv.compareSet;
    try { assert.equal((await refunds.refundBountyOnDeletedTarget('departed')).failures.length, 1); }
    finally { kv.compareSet = cas; }
    assert.equal(await balance('kaze'), 2_100);
    await refunds.refundBountyOnDeletedTarget('departed');
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance('kaze'), 2_100);
    assert.ok((await escrow()).entries[0].paidAt);
});

test('a failed owner credit remains pending and the sweep retries exactly once', async () => {
    await kv.set(KEY, place({ bounties: [] }, 'kaze', 2_000));
    const get = kv.get.bind(kv);
    kv.get = (async (key, ...args) => { if (key === 'save:kaze') throw new Error('owner storage unavailable'); return get(key, ...args); }) as typeof kv.get;
    try { assert.equal((await refunds.refundBountyOnDeletedTarget('departed')).failures.length, 1); }
    finally { kv.get = get; }
    await sweep(normalizeBoard(await kv.get(KEY)), Date.now());
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance('kaze'), 2_100);
});

test('invalid or absent ownership proof never authorizes a refund', async () => {
    for (const contributions of [undefined, [{ owner: 'stranger', ownerId: ids.kaze, amount: 3_001 }],
        [{ owner: 'kaze', ownerId: ids.kaze, amount: 4_000 }], [{ owner: 'kaze', ownerId: 'invalid-id', amount: 3_001 }]]) {
        for (const key of await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`)) await kv.del(key);
        await kv.set(KEY, normalizeBoard(normalizeBoard({ bounties: [{ ...head, contributions }] })));
        assert.deepEqual((await refunds.refundBountyOnDeletedTarget('departed')).refunded, {});
        assert.equal((await escrow()).unresolvedAmount, 3_001);
    }
    assert.equal(await balance('kaze'), 100);
});

test('historical journal sums are not current account/pool ownership proof', async () => {
    await kv.set(KEY, { bounties: [head] });
    await kv.set('economy-tx:pvp-bounty-place-old', { kind: 'pvp-bounty-place', state: 'complete', amount: 3_001, createdAt: 49,
        meta: { target: 'departed', playerName: 'kaze', plan: { target: 'departed', placer: 'kaze', amount: 3_001 } } });
    assert.deepEqual((await refunds.refundBountyOnDeletedTarget('departed')).refunded, {});
    assert.equal((await escrow()).unresolvedAmount, 3_001);
});

test('two generations of the same name retain separate ownership shares', async () => {
    let board = place({ bounties: [] }, 'kaze', 2_000);
    board = creditBountyPlacement(board, { placer: 'kaze', ownerId: ids.rival, target: 'Departed', amount: 1_000 }, 60)!;
    await kv.set('auth:kaze', { bountyOwnerId: ids.rival });
    await kv.set(KEY, normalizeBoard(board));
    assert.deepEqual((await refunds.refundBountyOnDeletedTarget('departed')).refunded, { kaze: 1_000 });
    assert.equal(await balance('kaze'), 1_100);
    const row = await escrow();
    assert.equal(row.entries.find(entry => entry.claim.ownerId === ids.kaze)?.hold, 'Original refund owner identity does not match');
    assert.ok(row.entries.find(entry => entry.claim.ownerId === ids.rival)?.paidAt);
});
