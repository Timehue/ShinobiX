import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * api/_save-debit-saga.ts against the real server storage adapter used by the
 * handler tests (the memory KV behind `kv`), the real fail-closed locks and the
 * real mutatePlayerSave. Faults are injected on the exact write they model.
 */

type Shared = { credited: number; settlementReceipts?: unknown[] };
type Plan = { amount: number };
type Result = { ryoAfter: number };

const PLAYER = 'sagaplayer';
const OTHER = 'sagaother';
const SAVE_KEY = `save:${PLAYER}`;
const SHARED_KEY = 'test:saga-shared';

let kv: typeof import('./_storage.js').kv;
let saga: typeof import('./_save-debit-saga.js');
let economyTxKey: typeof import('./_economy-tx.js').economyTxKey;
let LockContendedError: typeof import('./_lock.js').LockContendedError;
let WITH_REFUND: import('./_save-debit-saga.js').SaveDebitDefinition<Shared, Plan>;
let NO_REFUND: import('./_save-debit-saga.js').SaveDebitDefinition<Shared, Plan>;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    saga = await import('./_save-debit-saga.js');
    ({ economyTxKey } = await import('./_economy-tx.js'));
    ({ LockContendedError } = await import('./_lock.js'));
    WITH_REFUND = {
        kind: 'test-counter',
        load: async (key) => (await kv.get<Shared>(key)) ?? { credited: 0 },
        save: async (key, next) => { await kv.set(key, next); },
        applyCredit: (shared, plan) => ({ ...shared, credited: shared.credited + plan.amount }),
        refund: (character, plan) => ({ ...character, ryo: Number(character.ryo) + plan.amount }),
    };
    NO_REFUND = { ...WITH_REFUND, kind: 'test-counter-keep', refund: undefined };
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, level: 20, ryo: 1_000 } });
    await kv.set(`save:${OTHER}`, { _saveVersion: 1, character: { name: OTHER, level: 20, ryo: 1_000 } });
    await kv.set(SHARED_KEY, { credited: 0 });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function run(requestId: string | null, amount: number, opts: { definition?: typeof WITH_REFUND; player?: string } = {}) {
    return saga.runSaveDebitSaga<Shared, Plan, Result>({
        definition: opts.definition ?? WITH_REFUND,
        playerName: opts.player ?? PLAYER,
        requestId,
        identity: { amount },
        sharedKey: SHARED_KEY,
        resource: 'ryo',
        amount,
        decide: ({ character }) => {
            const ryo = Number(character.ryo);
            if (ryo < amount) return { ok: false, status: 400, error: 'Not enough ryo.' };
            return { ok: true, character: { ...character, ryo: ryo - amount }, plan: { amount }, result: { ryoAfter: ryo - amount } };
        },
    });
}

const ryo = async (player = PLAYER) => Number((await kv.get<{ character: { ryo: number } }>(`save:${player}`))?.character.ryo);
const credited = async () => Number((await kv.get<Shared>(SHARED_KEY))?.credited);
const saveReceipts = async (player = PLAYER) =>
    ((await kv.get<{ character: { serverSettlementReceipts?: unknown[] } }>(`save:${player}`))?.character.serverSettlementReceipts ?? []);
const journal = async (txId: string) => kv.get<{ state: string }>(economyTxKey(txId));

async function refusal(promise: Promise<unknown>): Promise<InstanceType<typeof saga.SaveDebitRefusal>> {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof saga.SaveDebitRefusal, `expected a SaveDebitRefusal, got ${String(error)}`);
        return error;
    }
    assert.fail('expected the saga to refuse');
}

describe('save->shared settlement saga', () => {
    test('first request debits once and credits once, each with its receipt, and completes the journal', async () => {
        const out = await run('saga-first-request-0001', 300);
        assert.equal(out.replayed, false);
        assert.equal(out.resumed, false);
        assert.deepEqual(out.result, { ryoAfter: 700 });
        assert.equal(await ryo(), 700);
        assert.equal(await credited(), 300);
        assert.equal((await saveReceipts()).length, 1, 'the debit carries its in-save receipt');
        const shared = await kv.get<Shared>(SHARED_KEY);
        assert.equal(saga.inspectSharedCredit(shared!, out.txId, saga.saveDebitFingerprint('test-counter', PLAYER, { amount: 300 })), 'applied');
        assert.equal((await journal(out.txId))?.state, 'complete');
        assert.equal(out._saveVersion, 2, 'the committed save version is reported');
    });

    test('an identical retry after success replays the stored result and moves nothing', async () => {
        const first = await run('saga-replay-request-01', 250);
        const again = await run('saga-replay-request-01', 250);
        assert.equal(again.replayed, true);
        assert.equal(again.txId, first.txId);
        assert.deepEqual(again.result, first.result);
        assert.equal(await ryo(), 750, 'debited exactly once');
        assert.equal(await credited(), 250, 'credited exactly once');
        assert.equal(again._saveVersion, first._saveVersion, 'a replay manufactures no save version');
    });

    test('the same request id with a different payload is refused before anything moves', async () => {
        await run('saga-conflict-request1', 100);
        const refused = await refusal(run('saga-conflict-request1', 200));
        assert.equal(refused.status, 409);
        assert.equal(await ryo(), 900);
        assert.equal(await credited(), 100);
    });

    test('two players using the same request id settle independently', async () => {
        await run('saga-shared-client-id', 100);
        await run('saga-shared-client-id', 100, { player: OTHER });
        assert.equal(await ryo(), 900);
        assert.equal(await ryo(OTHER), 900);
        assert.equal(await credited(), 200);
    });

    test('concurrent duplicates of one request debit once and credit once', async () => {
        const settled = await Promise.allSettled(Array.from({ length: 6 }, () => run('saga-concurrent-dupes1', 400)));
        const fresh = settled.filter((r) => r.status === 'fulfilled' && !r.value.replayed);
        const replays = settled.filter((r) => r.status === 'fulfilled' && r.value.replayed);
        const contended = settled.filter((r) => r.status === 'rejected');
        assert.equal(fresh.length, 1, 'exactly one request moves value');
        assert.equal(fresh.length + replays.length + contended.length, 6);
        for (const r of contended) assert.ok((r as PromiseRejectedResult).reason instanceof LockContendedError, String((r as PromiseRejectedResult).reason));
        assert.equal(await ryo(), 600);
        assert.equal(await credited(), 400);
    });

    test('a refusal writes nothing: no debit, no receipt, no journal', async () => {
        const refused = await refusal(run('saga-too-poor-request1', 5_000));
        assert.equal(refused.status, 400);
        assert.equal(await ryo(), 1_000);
        assert.equal(await credited(), 0);
        assert.deepEqual(await saveReceipts(), []);
        assert.deepEqual(await kv.keys('economy-tx:test-counter*'), []);
    });

    test('a debit write that fails commits nothing, and the retry settles once', async (t) => {
        const original = kv.compareSet.bind(kv);
        let fail = true;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (fail && args[0] === SAVE_KEY) { fail = false; throw new Error('injected save write failure'); }
            return original(...args);
        });
        await assert.rejects(run('saga-debit-write-fails', 100), /injected save write failure/);
        assert.equal(await ryo(), 1_000, 'nothing was debited');
        assert.equal(await credited(), 0);
        const out = await run('saga-debit-write-fails', 100);
        assert.equal(out.replayed, false);
        assert.equal(await ryo(), 900);
        assert.equal(await credited(), 100);
    });

    test('a credit write that fails refunds a currency sink in the same request', async (t) => {
        const original = kv.set.bind(kv);
        let fail = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (fail && args[0] === SHARED_KEY) { fail = false; throw new Error('injected shared write failure'); }
            return original(...args);
        });
        const refused = await refusal(run('saga-credit-fails-01', 300));
        assert.equal(refused.status, 503);
        assert.equal(refused.details.refunded, true);
        assert.equal(await ryo(), 1_000, 'the debit was given back');
        assert.deepEqual(await saveReceipts(), [], 'the receipt left with the debit, so the id is fresh again');
        assert.equal(await credited(), 0);
        const txId = saga.saveDebitTransactionId('test-counter', PLAYER, 'saga-credit-fails-01');
        assert.equal((await journal(txId))?.state, 'refunded');
        // The client keeps the id on a 503; its retry settles exactly once.
        const retry = await run('saga-credit-fails-01', 300);
        assert.equal(retry.replayed, false);
        assert.equal(await ryo(), 700);
        assert.equal(await credited(), 300);
        assert.equal((await journal(txId))?.state, 'complete');
    });

    test('a credit write that landed but reported failure is kept, not refunded', async (t) => {
        const original = kv.set.bind(kv);
        let fail = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            const out = await original(...args);
            if (fail && args[0] === SHARED_KEY) { fail = false; throw new Error('injected timeout after commit'); }
            return out;
        });
        const out = await run('saga-credit-landed-01', 200);
        assert.equal(out.replayed, false);
        assert.equal(await ryo(), 800);
        assert.equal(await credited(), 200);
    });

    /** The shared write throws (after landing, or not), then its readback throws once. */
    function unreadableCredit(t: import('node:test').TestContext, landed: boolean) {
        const originalSet = kv.set.bind(kv);
        const originalGet = kv.get.bind(kv);
        let failWrite = true;
        let failReadback = false;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (failWrite && args[0] === SHARED_KEY) {
                failWrite = false;
                if (landed) await originalSet(...args);
                failReadback = true;
                throw new Error('injected shared write timeout');
            }
            return originalSet(...args);
        });
        t.mock.method(kv, 'get', (async (key: string) => {
            if (failReadback && key === SHARED_KEY) { failReadback = false; throw new Error('injected readback failure'); }
            return originalGet(key);
        }) as typeof kv.get);
    }

    test('a credit that landed but could not be read back is not refunded, so nothing is minted', async (t) => {
        unreadableCredit(t, true);
        const refused = await refusal(run('saga-unknown-landed-01', 200));
        assert.equal(refused.status, 503);
        assert.equal(refused.details.pending, true);
        assert.equal(refused.details.refunded, undefined, 'an unknown credit is never refunded');
        assert.equal(await ryo(), 800, 'the debit stands');
        assert.equal(await credited(), 200, 'the credit had landed');
        t.mock.restoreAll();
        const retry = await run('saga-unknown-landed-01', 200);
        assert.equal(retry.replayed, true, 'the retry finds the credit already applied');
        assert.equal(await ryo(), 800, 'charged once');
        assert.equal(await credited(), 200, 'credited once');
    });

    test('a credit that did not land and could not be read back keeps the debit; the retry credits once', async (t) => {
        unreadableCredit(t, false);
        const refused = await refusal(run('saga-unknown-missed-01', 200));
        assert.equal(refused.status, 503);
        assert.equal(refused.details.pending, true);
        assert.equal(await ryo(), 800, 'the debit stands until the retry settles it');
        assert.equal(await credited(), 0);
        t.mock.restoreAll();
        const retry = await run('saga-unknown-missed-01', 200);
        assert.equal(retry.resumed, true, 'the retry applies the credit it can now prove absent');
        assert.equal(await ryo(), 800, 'charged once');
        assert.equal(await credited(), 200, 'credited once');
    });

    test('when the refund also fails, the retry rolls the credit forward exactly once', async (t) => {
        const originalSet = kv.set.bind(kv);
        const originalCompareSet = kv.compareSet.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === SHARED_KEY) throw new Error('injected shared write failure');
            return originalSet(...args);
        });
        let saveWrites = 0;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            // Let the debit through, then fail the refund's save write.
            if (broken && args[0] === SAVE_KEY && ++saveWrites > 1) throw new Error('injected refund failure');
            return originalCompareSet(...args);
        });
        const refused = await refusal(run('saga-refund-fails-001', 300));
        assert.equal(refused.status, 503);
        assert.equal(refused.details.pending, true);
        assert.equal(await ryo(), 700, 'the debit stands');
        assert.equal(await credited(), 0, 'the credit never landed');
        const txId = saga.saveDebitTransactionId('test-counter', PLAYER, 'saga-refund-fails-001');
        assert.equal((await journal(txId))?.state, 'needs-reconcile', 'the admin economy view lists it as stuck');

        broken = false;
        const resumed = await run('saga-refund-fails-001', 300);
        assert.equal(resumed.resumed, true);
        assert.equal(await ryo(), 700, 'the retry does not charge again');
        assert.equal(await credited(), 300, 'the retry finishes the credit');
        const again = await run('saga-refund-fails-001', 300);
        assert.equal(again.replayed, true);
        assert.equal(await credited(), 300);
        assert.equal((await journal(txId))?.state, 'complete');
    });

    test('a process stop between the debit and the credit is finished by the retry', async (t) => {
        // No refund hook: the debit stands exactly as a crash would leave it.
        const original = kv.set.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === SHARED_KEY) throw new Error('process stopped');
            return original(...args);
        });
        await refusal(run('saga-process-stop-001', 450, { definition: NO_REFUND }));
        broken = false;
        // A real crash leaves the journal where it was, not at needs-reconcile.
        const txId = saga.saveDebitTransactionId('test-counter-keep', PLAYER, 'saga-process-stop-001');
        await kv.set(economyTxKey(txId), { ...(await journal(txId)), state: 'debit-applied' });
        assert.equal(await ryo(), 550);
        assert.equal(await credited(), 0);
        const resumed = await run('saga-process-stop-001', 450, { definition: NO_REFUND });
        assert.equal(resumed.resumed, true);
        assert.equal(await ryo(), 550);
        assert.equal(await credited(), 450);
    });

    test('a stop after the credit but before the journal completes replays without a second credit', async () => {
        const out = await run('saga-journal-lagging1', 100);
        await kv.set(economyTxKey(out.txId), { ...(await journal(out.txId)), state: 'debit-applied' });
        const again = await run('saga-journal-lagging1', 100);
        assert.equal(again.replayed, true);
        assert.equal(await ryo(), 900);
        assert.equal(await credited(), 100);
        assert.equal((await journal(out.txId))?.state, 'complete');
    });

    test('an in-save receipt that aged out is still recognized through the completed journal', async () => {
        await run('saga-evicted-receipt1', 100);
        const save = await kv.get<Record<string, Record<string, unknown>>>(SAVE_KEY);
        await kv.set(SAVE_KEY, { ...save, character: { ...save!.character, serverSettlementReceipts: [] } });
        const again = await run('saga-evicted-receipt1', 100);
        assert.equal(again.replayed, true);
        assert.equal(await ryo(), 900, 'no second debit');
        assert.equal(await credited(), 100, 'no second credit');
    });

    test('a roll-forward refuses to credit when the shared receipts can no longer prove absence', async (t) => {
        const original = kv.set.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === SHARED_KEY) throw new Error('process stopped');
            return original(...args);
        });
        await refusal(run('saga-unprovable-00001', 100, { definition: NO_REFUND }));
        broken = false;
        // 100 newer receipts: the list is full and every entry postdates the debit.
        const later = Date.now() + 60_000;
        await kv.set(SHARED_KEY, {
            credited: 0,
            settlementReceipts: Array.from({ length: saga.SHARED_RECEIPT_LIMIT }, (_, i) => ({ transactionId: `other-${i}`, fingerprint: 'f', resource: 'ryo', amount: 1, appliedAt: later + i })),
        });
        const refused = await refusal(run('saga-unprovable-00001', 100, { definition: NO_REFUND }));
        assert.equal(refused.status, 409);
        assert.equal(refused.details.reconcile, true);
        assert.equal(await credited(), 0, 'never credits on an unprovable absence');
        assert.equal(await ryo(), 900);
    });
});

describe('receiptAbsenceProvable', () => {
    test('a list with room left proves absence', () => {
        assert.equal(saga.receiptAbsenceProvable([], 3, 'appliedAt', 10), true);
        assert.equal(saga.receiptAbsenceProvable([{ appliedAt: 99 }, { appliedAt: 98 }], 3, 'appliedAt', 10), true);
    });
    test('a full list proves absence only when its oldest entry predates the lower bound', () => {
        const full = [{ appliedAt: 30 }, { appliedAt: 20 }, { appliedAt: 5 }];
        assert.equal(saga.receiptAbsenceProvable(full, 3, 'appliedAt', 10), true);
        assert.equal(saga.receiptAbsenceProvable(full, 3, 'appliedAt', 5), false);
        assert.equal(saga.receiptAbsenceProvable([{ appliedAt: 30 }, { appliedAt: 'x' }, { appliedAt: 1 }], 3, 'appliedAt', 10), false,
            'an unreadable timestamp proves nothing');
    });
});

describe('resumeSaveDebitSaga (admin reconciliation)', () => {
    const definitions = () => ({ 'test-counter-keep': NO_REFUND as never });

    test('finishes a debit whose credit never landed, then reports it complete', async (t) => {
        const original = kv.set.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === SHARED_KEY) throw new Error('process stopped');
            return original(...args);
        });
        await refusal(run('saga-admin-resume-001', 120, { definition: NO_REFUND }));
        broken = false;
        const txId = saga.saveDebitTransactionId('test-counter-keep', PLAYER, 'saga-admin-resume-001');
        const first = await saga.resumeSaveDebitSaga(txId, definitions());
        assert.equal(first.status, 'completed');
        assert.equal(await credited(), 120);
        assert.equal(await ryo(), 880);
        const second = await saga.resumeSaveDebitSaga(txId, definitions());
        assert.equal(second.status, 'already-complete');
        assert.equal(await credited(), 120);
        // The player's own retry after the admin finished it is a plain replay.
        const retry = await run('saga-admin-resume-001', 120, { definition: NO_REFUND });
        assert.equal(retry.replayed, true);
        assert.equal(await credited(), 120);
    });

    test('a reserved journal with provably no debit is closed as refunded, moving nothing', async (t) => {
        const original = kv.compareSet.bind(kv);
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (args[0] === SAVE_KEY) throw new Error('injected save write failure');
            return original(...args);
        });
        await assert.rejects(run('saga-admin-nodebit-01', 100, { definition: NO_REFUND }));
        t.mock.restoreAll();
        const txId = saga.saveDebitTransactionId('test-counter-keep', PLAYER, 'saga-admin-nodebit-01');
        assert.equal((await journal(txId))?.state, 'reserved');
        const out = await saga.resumeSaveDebitSaga(txId, definitions());
        assert.equal(out.status, 'no-debit');
        assert.equal((await journal(txId))?.state, 'refunded');
        assert.equal(await ryo(), 1_000);
        assert.equal(await credited(), 0);
    });

    test('a journal written before retry-safe settlement is refused', async () => {
        await kv.set(economyTxKey('clan-treasury-donate:legacy'), {
            id: 'clan-treasury-donate:legacy', kind: 'clan-treasury-donate', state: 'needs-reconcile',
            debitKey: SAVE_KEY, creditKey: SHARED_KEY, resource: 'ryo', amount: 10, createdAt: 1, updatedAt: 1, meta: { clan: 'x' },
        });
        const refused = await refusal(saga.resumeSaveDebitSaga('clan-treasury-donate:legacy', definitions()));
        assert.equal(refused.status, 400);
    });
});
