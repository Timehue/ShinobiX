import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
process.env.ADMIN_PASSWORD = 'isolated-bounty-review-admin';
process.env.SESSION_SECRET = 'isolated-bounty-review-secret';
let kv: typeof import('../_storage.js').kv;
let remove: typeof import('../_delete-player-account.js').deletePlayerAccount;
let refunds: typeof import('./_bounty-deleted-target.js');
let sweep: typeof import('./_bounty-claim.js').sweepPendingBountyClaims;
let normalize: typeof import('./_bounty.js').normalizeBoard;
let handler: (req: never, res: never) => Promise<unknown>;
type Row = import('./_bounty-deleted-target.js').BountyOwnerRefund;
const KEY = 'pvp:bounties';
const save = (name: string, ryo: number) => ({ _saveVersion: 1, character: { name, ryo, level: 100,
    examsPassed: ['jonin'], inventory: [], itemStacks: [], pets: [], tileCards: [], equipment: {} }, creatorItems: [] });
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ deletePlayerAccount: remove } = await import('../_delete-player-account.js'));
    refunds = await import('./_bounty-deleted-target.js');
    ({ sweepPendingBountyClaims: sweep } = await import('./_bounty-claim.js'));
    ({ normalizeBoard: normalize } = await import('./_bounty.js'));
    handler = (await import('./bounty.js')).default as unknown as typeof handler;
});
async function place() {
    const out = { status: 200, body: {} };
    const res = { setHeader() {}, status(code: number) { out.status = code; return this; }, json(body: object) { out.body = body; return this; }, end() {} };
    await handler({ method: 'POST', headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' },
        body: { action: 'place', playerName: 'kaze', target: 'departed', amount: 2_000, requestId: randomUUID() } } as never, res as never);
    return out;
}
beforeEach(async () => {
    process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const name of ['kaze', 'departed']) {
        await kv.set(`save:${name}`, save(name, 10_000));
        await kv.set(`auth:${name}`, { hash: `scrypt:${name}`, salt: name, sessionEpoch: 0 });
    }
});
async function fundAndDeleteOwner() {
    const out = await place();
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const originalId = (await kv.get<{ bountyOwnerId: string }>('auth:kaze'))!.bountyOwnerId;
    assert.ok(originalId);
    const deletion = await remove('kaze');
    assert.deepEqual(deletion.failures, []);
    assert.equal(await kv.get('save:kaze'), null);
    assert.equal(await kv.get('auth:kaze'), null);
    return originalId;
}
async function registerReplacement() {
    await kv.set('save:kaze', save('kaze', 100));
    await kv.set('auth:kaze', { hash: 'scrypt:replacement', salt: 'replacement', sessionEpoch: 9, bountyOwnerId: randomUUID() });
}
async function balance() { return (await kv.get<ReturnType<typeof save>>('save:kaze'))!.character.ryo; }
async function escrow(): Promise<{ key: string; row: Row }> {
    const keys = await kv.keys(`${refunds.BOUNTY_OWNER_REFUND_PREFIX}*`);
    assert.equal(keys.length, 1);
    return { key: keys[0], row: (await kv.get<Row>(keys[0]))! };
}
/** Exact fields retained by the pre-policy board format; no new identity/hold fields. */
function oldNormalize(value: unknown) {
    const raw = value as Record<string, any>;
    const head = (b: any) => ({ target: b.target, amount: Math.max(0, Math.floor(Number(b.amount) || 0)),
        contributors: [...new Set((b.contributors ?? []).map((v: string) => v.trim().toLowerCase()))], updatedAt: Math.floor(Number(b.updatedAt) || 0) });
    const pending = (raw.pendingClaims ?? []).filter((p: any) => p.id && p.winner && p.head).map((p: any) => ({
        id: p.id, winner: p.winner, head: head(p.head), at: Math.floor(Number(p.at) || 0), ...(p.battleId ? { battleId: p.battleId } : {}),
    }));
    return { bounties: (raw.bounties ?? []).map(head), ...(pending.length ? { pendingClaims: pending } : {}),
        ...(raw.settlementReceipts ? { settlementReceipts: raw.settlementReceipts } : {}) };
}

test('replacement registered before target deletion cannot receive the original owner refund', async () => {
    await fundAndDeleteOwner();
    await registerReplacement();
    assert.deepEqual((await remove('departed')).failures, []);
    assert.equal(await balance(), 100);
    assert.equal((await escrow()).row.entries[0].claim.head.amount, 2_000);
    assert.match((await escrow()).row.entries[0].hold!, /identity does not match/);
});
for (const retry of ['refund', 'sweep'] as const) {
    test(`lost missing-owner hold write cannot pay a replacement on ${retry} retry`, async () => {
        await fundAndDeleteOwner();
        const cas = kv.compareSet.bind(kv);
        let observedMissingOwner = false;
        kv.compareSet = (async (key, expected, value, ...args) => {
            if (key.startsWith(refunds.BOUNTY_OWNER_REFUND_PREFIX) && expected !== null) {
                observedMissingOwner = (value as Row).entries[0].hold === 'missing-owner';
                throw new Error('injected completion write failure');
            }
            return cas(key, expected, value, ...args);
        }) as typeof kv.compareSet;
        try { assert.equal((await refunds.refundBountyOnDeletedTarget('departed', 100)).failures.length, 1); }
        finally { kv.compareSet = cas; }
        assert.equal(observedMissingOwner, true);
        assert.equal((await escrow()).row.entries[0].hold, undefined);
        await registerReplacement();
        if (retry === 'refund') await refunds.refundBountyOnDeletedTarget('departed', 100_000);
        else await sweep(normalize(await kv.get(KEY)), 100_000);
        assert.equal(await balance(), 100);
        assert.match((await escrow()).row.entries[0].hold!, /identity does not match/);
    });
}
for (const reason of ['unproven-contributions', 'missing-owner'] as const) {
    test(`old board writers cannot erase separate ${reason} escrow`, async () => {
        if (reason === 'missing-owner') await fundAndDeleteOwner();
        else await kv.set(KEY, { bounties: [{ target: 'departed', amount: 2_000, contributors: ['kaze', 'rival'], updatedAt: 50 }] });
        await refunds.refundBountyOnDeletedTarget('departed', 100);
        const before = await escrow();
        await kv.set(KEY, oldNormalize(await kv.get(KEY)));
        assert.deepEqual(await kv.get(before.key), before.row);
        if (reason === 'missing-owner') {
            await registerReplacement();
            await sweep(normalize(await kv.get(KEY)), 100_000);
            assert.equal(await balance(), 100);
            assert.equal((await escrow()).row.entries[0].hold, 'missing-owner');
        } else assert.equal((await escrow()).row.unresolvedAmount, 2_000);
    });
}

test('identity publication is atomic with the placement debit', async () => {
    const many = kv.compareSetMany!.bind(kv);
    let observedIdentity = false;
    kv.compareSetMany = (async (ops) => {
        if (ops.some(op => op.key === 'auth:kaze')) {
            observedIdentity = true;
            throw new Error('identity/debit transaction unavailable');
        }
        return many(ops);
    }) as typeof kv.compareSetMany;
    try { assert.notEqual((await place()).status, 200); }
    finally { kv.compareSetMany = many; }
    assert.equal(observedIdentity, true);
    assert.equal(await balance(), 10_000);
    assert.equal((await kv.get<{ bountyOwnerId?: string }>('auth:kaze'))!.bountyOwnerId, undefined);
    assert.equal(normalize(await kv.get(KEY)).bounties.length, 0);
});

test('an identity change between refund check and atomic commit refuses the payout', async () => {
    assert.equal((await place()).status, 200);
    const before = await balance();
    const many = kv.compareSetMany!.bind(kv);
    let raced = false;
    kv.compareSetMany = (async (ops) => {
        if (!raced && ops.some(op => op.key === 'save:kaze') && ops.some(op => op.key === 'auth:kaze')) {
            raced = true;
            await kv.set('auth:kaze', { bountyOwnerId: randomUUID(), hash: 'replacement', salt: 'replacement' });
        }
        return many(ops);
    }) as typeof kv.compareSetMany;
    try { await refunds.refundBountyOnDeletedTarget('departed'); }
    finally { kv.compareSetMany = many; }
    assert.equal(raced, true);
    assert.equal(await balance(), before);
    assert.equal((await escrow()).row.entries[0].paidAt, undefined);
});

test('credential changes preserving account identity still permit the rightful refund', async () => {
    assert.equal((await place()).status, 200);
    const auth = await kv.get<Record<string, unknown>>('auth:kaze');
    await kv.set('auth:kaze', { ...auth, hash: 'new-password', salt: 'new-salt', sessionEpoch: 1 });
    assert.deepEqual((await refunds.refundBountyOnDeletedTarget('departed')).refunded, { kaze: 2_000 });
    assert.equal(await balance(), 9_700, 'only the posting fee remains spent');
});

test('hold-only stage preserves verified funds until an explicit activation', async () => {
    assert.equal((await place()).status, 200);
    delete process.env.BOUNTY_OWNER_REFUNDS_ENABLED;
    const before = await balance();
    const result = await refunds.refundBountyOnDeletedTarget('departed');
    assert.deepEqual(result.failures, []);
    assert.equal(await balance(), before);
    await kv.set(KEY, oldNormalize(await kv.get(KEY)));
    process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
    await refunds.settleBountyOwnerRefunds();
    assert.equal(await balance(), before + 2_000);
});

test('old writers dropping live contribution identity cause a safe hold, never a guessed refund', async () => {
    assert.equal((await place()).status, 200);
    await kv.set(KEY, oldNormalize(await kv.get(KEY)));
    const before = await balance();
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance(), before);
    assert.equal((await escrow()).row.unresolvedAmount, 2_000);
});

test('a lost acknowledgement after the atomic board-to-escrow move recovers without losing or doubling funds', async () => {
    assert.equal((await place()).status, 200);
    const before = await balance();
    const many = kv.compareSetMany!.bind(kv);
    let interrupted = false;
    kv.compareSetMany = async (ops) => {
        const result = await many(ops);
        if (!interrupted && ops.some(op => op.key.startsWith(refunds.BOUNTY_OWNER_REFUND_PREFIX))) {
            interrupted = true;
            throw new Error('lost reservation acknowledgement');
        }
        return result;
    };
    try { await assert.rejects(refunds.refundBountyOnDeletedTarget('departed'), /lost reservation acknowledgement/); }
    finally { kv.compareSetMany = many; }
    assert.equal(normalize(await kv.get(KEY)).bounties.length, 0);
    assert.equal((await escrow()).row.head.amount, 2_000);
    assert.equal(await balance(), before);
    await refunds.refundBountyOnDeletedTarget('departed');
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance(), before + 2_000);
});

test('malformed external escrow fails closed and remains intact', async () => {
    assert.equal((await place()).status, 200);
    delete process.env.BOUNTY_OWNER_REFUNDS_ENABLED;
    await refunds.refundBountyOnDeletedTarget('departed');
    const { key, row } = await escrow();
    const corrupted = { ...row, unresolvedAmount: 1 };
    await kv.set(key, corrupted);
    process.env.BOUNTY_OWNER_REFUNDS_ENABLED = '1';
    const before = await balance();
    assert.equal((await refunds.settleBountyOwnerRefunds()).failures.length, 1);
    assert.equal(await balance(), before);
    assert.deepEqual(await kv.get(key), corrupted);
});

test('legacy migration refuses entries the normalizer cannot preserve', async () => {
    const raw = { bounties: [], pendingClaims: [{ id: 'deleted-target:departed:broken', winner: '',
        head: { target: 'departed', amount: 2_000, contributors: ['kaze'], updatedAt: 50 }, at: 100 }] };
    await kv.set(KEY, raw);
    await assert.rejects(refunds.migrateLegacyBountyRefunds(), /manual inspection/);
    assert.deepEqual(await kv.get(KEY), raw);
});

test('legacy share evidence is retained for reconciliation without becoming account authority', async () => {
    const originalHead = { target: 'departed', amount: 2_000, contributors: ['kaze'], updatedAt: 50, contributionAmounts: { kaze: 2_000 } };
    await kv.set(KEY, { bounties: [originalHead] });
    await refunds.refundBountyOnDeletedTarget('departed');
    assert.equal(await balance(), 10_000);
    assert.equal((await escrow()).row.unresolvedAmount, 2_000);
    assert.deepEqual((await escrow()).row.originalHead, originalHead);
});

for (const ownerless of [true, false]) {
    test(`legacy ${ownerless ? 'ownerless' : 'missing-owner'} board escrow migrates atomically to a conservative hold`, async () => {
        const legacy = { id: 'deleted-target:departed:50:legacy', winner: ownerless ? '' : 'kaze',
            head: { target: 'departed', amount: 2_000, contributors: ['kaze'], updatedAt: 50 }, at: 100,
            refundHold: ownerless ? 'unproven-contributions' : 'missing-owner' };
        await kv.set(KEY, { bounties: [], pendingClaims: [legacy] });
        assert.equal(await refunds.migrateLegacyBountyRefunds(), 1);
        assert.equal(await refunds.migrateLegacyBountyRefunds(), 0);
        const row = (await escrow()).row;
        assert.equal(row.unresolvedAmount, 2_000);
        assert.deepEqual(row.legacyClaim, legacy);
        await kv.set(KEY, oldNormalize(await kv.get(KEY)));
        await refunds.settleBountyOwnerRefunds();
        assert.equal(await balance(), 10_000);
        assert.equal((await escrow()).row.unresolvedAmount, 2_000);
    });
}
