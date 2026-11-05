import assert from 'node:assert/strict';
import { before, beforeEach, it, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'deletion-exchange-lock-order-regression';

type Obj = Record<string, any>;
let kv: typeof import('./_storage.js').kv;
let locks: typeof import('./_lock.js');
let context: typeof import('./_kv-lock-context.js');
let exchange: typeof import('./festival/_exchange.js');
let deletion: typeof import('./_delete-player-account.js');
let budget: typeof import('./player/_transfer-budget.js');
let donate: typeof import('./clan/treasury/donate.js').default;
let token: typeof import('./_auth.js').issuePlayerToken;

function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    locks = await import('./_lock.js');
    context = await import('./_kv-lock-context.js');
    exchange = await import('./festival/_exchange.js');
    deletion = await import('./_delete-player-account.js');
    budget = await import('./player/_transfer-budget.js');
    donate = (await import('./clan/treasury/donate.js')).default as unknown as typeof donate;
    token = (await import('./_auth.js')).issuePlayerToken;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await kv.set('save:donor', { _saveVersion: 1, character: {
        name: 'donor', clan: 'Mist', level: 5, ryo: 10_000, fateShards: 100,
        inventory: [], itemStacks: [], pets: [], tileCards: [], equipment: {},
    } });
    await kv.set('auth:donor', { hash: 'scrypt:owner', salt: 's', sessionEpoch: 0 });
    await kv.set('save:clan-mist', { name: 'Mist', founderName: 'other',
        members: [], treasury: { ryo: 0, fateShards: 0, items: [] }, xp: 0, level: 1 });
});

async function pendingEscrow(t: TestContext) {
    const store = kv as typeof kv & Required<Pick<typeof kv, 'compareSetMany'>>;
    const commit = store.compareSetMany.bind(store);
    const fault = t.mock.method(store, 'compareSetMany', async (ops: readonly import('./_storage.js').KvCasOp[]) => {
        if (ops.some(op => op.key === budget.transferBudgetKey('donor', 'fateShards'))) {
            throw new Error('injected outage before escrow debit');
        }
        return commit(ops);
    });
    try {
        await assert.rejects(exchange.createExchangeListing('donor', {
            requestId: randomUUID(), kind: 'resource', assetId: 'fateShards', quantity: 20, price: 1,
        }));
    } finally { fault.mock.restore(); }
    const keys = await kv.keys('sunscar-exchange:listing:*');
    assert.equal(keys.length, 1);
    assert.equal((await kv.get<Obj>(keys[0]))?.state, 'preparing');
    return keys[0];
}

async function donateFive() {
    let status = 200;
    let body: unknown;
    const res = { setHeader() {}, status(code: number) { status = code; return this; },
        json(value: unknown) { body = value; return this; }, end() {} };
    await donate({ method: 'POST', body: { playerName: 'donor', clan: 'Mist', currency: 'fateShards', amount: 5,
        requestId: 'delete-lock-donation-0001' },
        headers: { 'x-player-name': 'donor', 'x-player-token': token('donor')! },
        socket: { remoteAddress: '127.0.18.1' } } as never, res as never);
    return { status, body };
}

it('defers deletion without waiting on a donor gate held by a donation waiting for its save', { timeout: 15_000 }, async t => {
    const listingKey = await pendingEscrow(t);
    const gateKey = `lock:${budget.transferGateKey('donor', 'fateShards')}`;
    const gateHeld = signal();
    const deletionRequestsGate = signal();
    const donationRequestsSave = signal();
    const set = kv.set.bind(kv);
    let deletionGateAttempts = 0;
    let donationSaveAttempts = 0;
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: any) => {
        if (options?.nx && key === gateKey && context.alreadyHoldsKvLock('save:donor')) {
            deletionGateAttempts++;
            deletionRequestsGate.resolve();
            // Ensure both halves of the cycle are actually attempted. No sleeps
            // or assumptions about which request the scheduler runs first.
            await donationRequestsSave.promise;
        }
        if (options?.nx && key === 'lock:save:donor' && context.alreadyHoldsKvLock(budget.transferGateKey('donor', 'fateShards'))) {
            donationSaveAttempts++;
            donationRequestsSave.resolve();
        }
        const result = await set(key, value, options);
        if (options?.nx && key === gateKey && result && !context.alreadyHoldsKvLock('save:donor')) {
            gateHeld.resolve();
            await deletionRequestsGate.promise;
        }
        return result;
    });
    const donationRun = donateFive();
    await gateHeld.promise;
    // The guest sweep and interactive DELETE hold this same save lock around
    // teardown. Exercise full teardown rather than only the Exchange helper.
    const deletionRun = locks.withKvLock('save:donor', () => deletion.deletePlayerAccount('donor'), { failClosed: true });
    const [removed, donated] = await Promise.all([deletionRun, donationRun]);
    t.diagnostic(JSON.stringify({ deletionGateAttempts, donationSaveAttempts, failures: removed.failures, donationStatus: donated.status }));
    assert.equal(deletionGateAttempts, 1, 'reverse-order deletion must never queue behind the gate');
    assert.ok(donationSaveAttempts >= 1, 'the other request really attempted the held save');
    assert.match(removed.failures.join('; '), /xfer:gate:donor:fateShards/);
    assert.equal(donated.status, 200, JSON.stringify(donated.body));
    assert.ok(await kv.get('auth:donor'), 'failed cleanup retains the account retry anchor');
    assert.equal((await kv.get<Obj>('save:donor'))?.character.fateShards, 95);
    assert.equal((await kv.get<Obj>('save:clan-mist'))?.treasury.fateShards, 5);
    assert.equal((await kv.get<Obj>(listingKey))?.state, 'preparing');
    assert.equal((await budget.checkOutboundBudget('donor', 'fateShards', 0, 'restricted')).spent, 5);

    const retry = await locks.withKvLock('save:donor', () => deletion.deletePlayerAccount('donor'), { failClosed: true });
    assert.deepEqual(retry.failures, []);
    assert.equal(await kv.get('save:donor'), null);
    assert.equal(await kv.get('auth:donor'), null);
    assert.equal((await kv.get<Obj>(listingKey))?.state, 'cancelled');
    assert.equal((await budget.checkOutboundBudget('donor', 'fateShards', 0, 'restricted')).spent, 25,
        'retry charges the 20-unit escrow once, alongside the 5-unit donation');
    await exchange.settleExchangeForDeletedPlayer('donor');
    assert.equal((await budget.checkOutboundBudget('donor', 'fateShards', 0, 'restricted')).spent, 25);
    assert.equal((await kv.get<Obj>('save:clan-mist'))?.treasury.fateShards, 5);
});

it('defers deletion if the listing owner is waiting for the deleting player save', { timeout: 15_000 }, async t => {
    const listingKey = await pendingEscrow(t);
    const listingHeld = signal();
    const deletionRequestsListing = signal();
    const recoveryRequestsSave = signal();
    const set = kv.set.bind(kv);
    let deletionListingAttempts = 0;
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: any) => {
        if (options?.nx && key === `lock:${listingKey}` && context.alreadyHoldsKvLock('save:donor')) {
            deletionListingAttempts++;
            deletionRequestsListing.resolve();
            await recoveryRequestsSave.promise;
        }
        if (options?.nx && key === 'lock:save:donor' && context.alreadyHoldsKvLock(listingKey)) recoveryRequestsSave.resolve();
        return set(key, value, options);
    });
    const recovery = locks.withKvLock(listingKey, async () => {
        listingHeld.resolve();
        await deletionRequestsListing.promise;
        return exchange.recoverPendingExchangeListings();
    }, { failClosed: true });
    await listingHeld.promise;
    const removed = await locks.withKvLock('save:donor', () => deletion.deletePlayerAccount('donor'), { failClosed: true });
    assert.equal(deletionListingAttempts, 1);
    assert.match(removed.failures.join('; '), /sunscar-exchange:listing:/);
    assert.ok(await kv.get('auth:donor'));
    assert.deepEqual((await recovery).failures, []);
    assert.equal((await kv.get<Obj>('save:donor'))?.character.fateShards, 80);
    assert.equal((await budget.checkOutboundBudget('donor', 'fateShards', 0, 'restricted')).spent, 20);
    assert.equal((await kv.get<Obj>(listingKey))?.state, 'active');
    const retry = await locks.withKvLock('save:donor', () => deletion.deletePlayerAccount('donor'), { failClosed: true });
    assert.deepEqual(retry.failures, []);
    assert.equal((await kv.get<Obj>(listingKey))?.state, 'cancelled');
    assert.equal(await kv.get('save:donor'), null);
    assert.equal((await budget.checkOutboundBudget('donor', 'fateShards', 0, 'restricted')).spent, 20);
});

it('non-waiting scope is inherited, fails closed, preserves the lease, and does not change concurrent requests', async t => {
    const attempts = new Map<string, number>();
    const set = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: any) => {
        if (options?.nx && key.includes('busy-test')) {
            attempts.set(key, (attempts.get(key) ?? 0) + 1);
            return null;
        }
        return set(key, value, options);
    });
    const entered = signal();
    const finish = signal();
    let ranWithoutLock = false;
    const scoped = locks.withKvLock('save:donor', () => locks.withNonWaitingKvLocks(async () => {
        const owner = await kv.get('lock:save:donor');
        const lease = context.currentKvLockContext();
        await locks.withKvLock('save:donor', async () => {
            assert.equal(await kv.get('lock:save:donor'), owner, 'reentrant lock keeps its original owner');
            assert.equal(context.currentKvLockContext(), lease, 'lease fencing context is retained');
        });
        await locks.withKvLock('free-parent', async () => {
            await assert.rejects(locks.withKvLock('nested-busy-test', async () => { ranWithoutLock = true; },
                { maxAttempts: 9, failClosed: false }), locks.LockContendedError);
        });
        entered.resolve();
        await finish.promise;
    }), { failClosed: true });
    await entered.promise;
    try {
        await assert.rejects(locks.withKvLock('concurrent-busy-test', async () => {},
            { maxAttempts: 2, baseBackoffMs: 0, failClosed: true }), locks.LockContendedError);
    } finally { finish.resolve(); }
    await scoped;
    assert.equal(ranWithoutLock, false);
    assert.equal(attempts.get('lock:nested-busy-test'), 1);
    assert.equal(attempts.get('lock:concurrent-busy-test'), 2);
    assert.equal(await kv.get('lock:save:donor'), null);
    assert.equal(await kv.get('lock:free-parent'), null);
});
