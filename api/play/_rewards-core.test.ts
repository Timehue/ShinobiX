import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { claimPlayGamesReward, PlayRewardClaimError, type PlayRewardClaimDependencies, type PlayRewardReceipt } from './_rewards-core.js';

const PLAYER = 'raven';
const TOKEN = 'play-purchase-token-for-tests-0001';
const PRODUCT = 'sj_reward_title_dawn';

function fixture(overrides: Partial<PlayRewardClaimDependencies> = {}) {
    const receipts = new Map<string, PlayRewardReceipt>();
    const owned = new Set<string>();
    let verificationState = 0;
    const acknowledgedTokens = new Set<string>();
    const consumedTokens = new Set<string>();
    let failAcknowledge = false;
    let failConsume = false;
    let verifyCalls = 0;
    let acknowledgeCalls = 0;
    let consumeCalls = 0;
    let grantCalls = 0;
    const ryoReceipts = new Set<string>();
    let ryoBalance = 0;
    const dependencies: PlayRewardClaimDependencies = {
        getReceipt: async (key) => receipts.get(key) ?? null,
        setReceipt: async (key, value) => { receipts.set(key, structuredClone(value)); },
        withLock: async (_key, action) => action(),
        verifyPurchase: async (_productId, purchaseToken) => {
            verifyCalls += 1;
            return {
                purchaseState: verificationState,
                acknowledged: acknowledgedTokens.has(purchaseToken),
                consumed: consumedTokens.has(purchaseToken),
            };
        },
        acknowledgePurchase: async (_productId, purchaseToken) => {
            acknowledgeCalls += 1;
            if (failAcknowledge) throw new Error('transient Google error');
            acknowledgedTokens.add(purchaseToken);
        },
        consumePurchase: async (_productId, purchaseToken) => {
            consumeCalls += 1;
            if (failConsume) throw new Error('transient Google consume error');
            consumedTokens.add(purchaseToken);
            acknowledgedTokens.add(purchaseToken);
        },
        grantTitle: async (_player, title) => {
            grantCalls += 1;
            const alreadyOwned = owned.has(title);
            owned.add(title);
            return { ok: true, alreadyOwned, character: { serverTitles: [...owned] }, saveVersion: 3 };
        },
        grantRyo: async (_player, amount, purchaseDigest) => {
            const alreadyOwned = ryoReceipts.has(purchaseDigest);
            if (!alreadyOwned) {
                ryoBalance += amount;
                ryoReceipts.add(purchaseDigest);
            }
            grantCalls += 1;
            return { ok: true, alreadyOwned, character: { ryo: ryoBalance, playRewardPurchaseReceipts: [...ryoReceipts] }, saveVersion: 3 };
        },
        now: () => 1000,
        ...overrides,
    };
    return {
        dependencies,
        receipts,
        owned,
        ryoReceipts,
        ryoBalance: () => ryoBalance,
        counts: () => ({ verifyCalls, acknowledgeCalls, consumeCalls, grantCalls }),
        setVerificationState: (value: number) => { verificationState = value; },
        setAcknowledged: (value: boolean) => { value ? acknowledgedTokens.add(TOKEN) : acknowledgedTokens.delete(TOKEN); },
        setConsumed: (purchaseToken: string, value: boolean) => { value ? consumedTokens.add(purchaseToken) : consumedTokens.delete(purchaseToken); },
        setFailAcknowledge: (value: boolean) => { failAcknowledge = value; },
        setFailConsume: (value: boolean) => { failConsume = value; },
    };
}

test('a purchased reward grants one server title and acknowledges only after delivery', async () => {
    const f = fixture();
    const result = await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    assert.deepEqual(result, {
        rewardLabel: 'Dawn-Sealed Shinobi',
        title: 'Dawn-Sealed Shinobi',
        granted: true,
        acknowledged: true,
        alreadyOwned: false,
        character: { serverTitles: ['Dawn-Sealed Shinobi'] },
        saveVersion: 3,
    });
    assert.deepEqual(f.counts(), { verifyCalls: 1, acknowledgeCalls: 1, consumeCalls: 0, grantCalls: 1 });
    assert.equal([...f.receipts.values()][0]?.state, 'acknowledged');
    assert.equal(JSON.stringify([...f.receipts.values()]).includes(TOKEN), false, 'raw purchase tokens must never be persisted');
});

test('pending or cancelled Play purchases cannot create a title or receipt', async () => {
    const f = fixture();
    f.setVerificationState(2);
    await assert.rejects(
        claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies),
        (error: unknown) => error instanceof PlayRewardClaimError && error.status === 409,
    );
    assert.equal(f.owned.size, 0);
    assert.equal(f.receipts.size, 0);
    assert.equal(f.counts().acknowledgeCalls, 0);
});

test('unknown products and malformed tokens fail closed before Google or save calls', async () => {
    const f = fixture();
    await assert.rejects(
        claimPlayGamesReward({ playerName: PLAYER, productId: 'unknown_sku', purchaseToken: TOKEN }, f.dependencies),
        (error: unknown) => error instanceof PlayRewardClaimError && error.status === 400,
    );
    await assert.rejects(
        claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: 'tiny' }, f.dependencies),
        (error: unknown) => error instanceof PlayRewardClaimError && error.status === 400,
    );
    assert.deepEqual(f.counts(), { verifyCalls: 0, acknowledgeCalls: 0, consumeCalls: 0, grantCalls: 0 });
});

test('the same verified receipt cannot be claimed for a second game account', async () => {
    const f = fixture();
    await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    await assert.rejects(
        claimPlayGamesReward({ playerName: 'other', productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies),
        (error: unknown) => error instanceof PlayRewardClaimError && error.status === 409,
    );
    assert.deepEqual(f.counts(), { verifyCalls: 1, acknowledgeCalls: 1, consumeCalls: 0, grantCalls: 1 });
});

test('a failed acknowledgement is retried without duplicating the title', async () => {
    const f = fixture();
    f.setFailAcknowledge(true);
    const first = await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    assert.equal(first.granted, true);
    assert.equal(first.acknowledged, false);
    assert.equal([...f.receipts.values()][0]?.state, 'granted');

    f.setFailAcknowledge(false);
    const second = await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    assert.equal(second.granted, false);
    assert.equal(second.alreadyOwned, true);
    assert.equal(second.acknowledged, true);
    assert.equal(f.owned.size, 1);
    assert.equal([...f.receipts.values()][0]?.state, 'acknowledged');
    assert.deepEqual(f.counts(), { verifyCalls: 2, acknowledgeCalls: 2, consumeCalls: 0, grantCalls: 2 });
});

test('an acknowledged receipt retry recovers the save snapshot without re-verifying or re-acknowledging', async () => {
    const f = fixture();
    await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    const retry = await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    assert.equal(retry.acknowledged, true);
    assert.equal(retry.granted, false);
    assert.deepEqual(retry.character, { serverTitles: ['Dawn-Sealed Shinobi'] });
    assert.deepEqual(f.counts(), { verifyCalls: 1, acknowledgeCalls: 1, consumeCalls: 0, grantCalls: 2 });
});

test('retry after a save write but before its receipt update relies on the save title union', async () => {
    let owned = false;
    let failSecondReceiptWrite = true;
    const f = fixture({
        grantTitle: async () => {
            const alreadyOwned = owned;
            owned = true;
            return { ok: true, alreadyOwned };
        },
        setReceipt: async (key, value) => {
            if (value.state === 'granted' && failSecondReceiptWrite) {
                failSecondReceiptWrite = false;
                throw new Error('storage blip after the save write');
            }
            f.receipts.set(key, structuredClone(value));
        },
    });
    await assert.rejects(claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies));
    assert.equal(owned, true);
    const second = await claimPlayGamesReward({ playerName: PLAYER, productId: PRODUCT, purchaseToken: TOKEN }, f.dependencies);
    assert.equal(second.alreadyOwned, true);
    assert.equal(owned, true);
});

test('the repeatable Ryo cache is credited once per verified purchase token', async () => {
    const f = fixture();
    const purchase = { playerName: PLAYER, productId: 'sj_reward_ryo_cache_small', purchaseToken: TOKEN };
    const first = await claimPlayGamesReward(purchase, f.dependencies);
    const replay = await claimPlayGamesReward(purchase, f.dependencies);
    assert.equal(first.rewardLabel, '100 Ryo Cache');
    assert.equal(first.ryo, 100);
    assert.equal(first.granted, true);
    assert.equal(replay.granted, false);
    assert.equal(replay.alreadyOwned, true);
    assert.equal(f.ryoBalance(), 100);
    assert.equal(f.ryoReceipts.size, 1);
    assert.equal([...f.receipts.values()][0]?.state, 'consumed');
    assert.deepEqual(f.counts(), { verifyCalls: 1, acknowledgeCalls: 0, consumeCalls: 1, grantCalls: 2 });

    const nextWeeklyPurchase = await claimPlayGamesReward({ ...purchase, purchaseToken: `${TOKEN}-next` }, f.dependencies);
    assert.equal(nextWeeklyPurchase.granted, true);
    assert.equal(f.ryoBalance(), 200);
    assert.equal(f.ryoReceipts.size, 2);
    assert.equal(f.counts().consumeCalls, 2);
});

test('a failed Ryo consumption retries without crediting the cache twice', async () => {
    const f = fixture();
    const purchase = { playerName: PLAYER, productId: 'sj_reward_ryo_cache_small', purchaseToken: TOKEN };
    f.setFailConsume(true);
    const first = await claimPlayGamesReward(purchase, f.dependencies);
    assert.equal(first.granted, true);
    assert.equal(first.acknowledged, false);
    assert.equal(f.ryoBalance(), 100);
    assert.equal([...f.receipts.values()][0]?.state, 'granted');

    f.setFailConsume(false);
    const retry = await claimPlayGamesReward(purchase, f.dependencies);
    assert.equal(retry.granted, false);
    assert.equal(retry.alreadyOwned, true);
    assert.equal(retry.acknowledged, true);
    assert.equal(f.ryoBalance(), 100);
    assert.equal([...f.receipts.values()][0]?.state, 'consumed');
    assert.equal(f.counts().consumeCalls, 2);
});

test('a legacy acknowledged Ryo receipt is consumed on retry without a second credit', async () => {
    const f = fixture();
    const productId = 'sj_reward_ryo_cache_small';
    const digest = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
    f.ryoReceipts.add(digest);
    f.setAcknowledged(true);
    f.receipts.set(`play:reward:purchase:${digest}`, {
        version: 1,
        playerName: PLAYER,
        productId,
        rewardLabel: '100 Ryo Cache',
        state: 'acknowledged',
        grantedAt: 900,
        acknowledgedAt: 950,
    });

    const result = await claimPlayGamesReward({ playerName: PLAYER, productId, purchaseToken: TOKEN }, f.dependencies);
    assert.equal(result.granted, false);
    assert.equal(result.alreadyOwned, true);
    assert.equal(result.acknowledged, true);
    assert.equal(f.counts().consumeCalls, 1);
    assert.equal([...f.receipts.values()][0]?.state, 'consumed');
});

test('an already-consumed Ryo token without its owner receipt cannot be credited', async () => {
    const f = fixture();
    f.setConsumed(TOKEN, true);
    await assert.rejects(
        claimPlayGamesReward({ playerName: PLAYER, productId: 'sj_reward_ryo_cache_small', purchaseToken: TOKEN }, f.dependencies),
        (error: unknown) => error instanceof PlayRewardClaimError && error.status === 409,
    );
    assert.equal(f.ryoBalance(), 0);
    assert.equal(f.receipts.size, 0);
    assert.equal(f.counts().consumeCalls, 0);
});

test('a Ryo cache retry after save commit but before receipt journal update does not double-credit', async () => {
    let balance = 0;
    const applied = new Set<string>();
    let failGrantedWrite = true;
    const f = fixture({
        grantRyo: async (_player, amount, digest) => {
            const alreadyOwned = applied.has(digest);
            if (!alreadyOwned) {
                balance += amount;
                applied.add(digest);
            }
            return { ok: true, alreadyOwned, character: { ryo: balance, playRewardPurchaseReceipts: [...applied] }, saveVersion: 3 };
        },
        setReceipt: async (key, value) => {
            if (value.state === 'granted' && failGrantedWrite) {
                failGrantedWrite = false;
                throw new Error('receipt journal write failed after save commit');
            }
            f.receipts.set(key, structuredClone(value));
        },
    });
    const purchase = { playerName: PLAYER, productId: 'sj_reward_ryo_cache_small', purchaseToken: TOKEN };
    await assert.rejects(claimPlayGamesReward(purchase, f.dependencies));
    const retry = await claimPlayGamesReward(purchase, f.dependencies);
    assert.equal(retry.alreadyOwned, true);
    assert.equal(balance, 100);
    assert.equal(applied.size, 1);
});
