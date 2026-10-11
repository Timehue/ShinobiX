import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * commitPlayerSaveRecord — the commit every player-save writer goes through
 * (P0-5). A write that moves currency commits the save and its ledger row in
 * one transaction, after classifying the stored row against the stored save;
 * a write that does not move currency is the same single compare-and-set as
 * before. These pin both paths, every classification, the races, and the two
 * emergency switches.
 */

type Store = import('../_storage.js').KvLike;
type Rec = Record<string, unknown>;

let storage: typeof import('../_storage.js');
let commitMod: typeof import('./_commit-player-save.js');
let ledgerMod: typeof import('../_currency-ledger.js');
let drainBackgroundWork: typeof import('../_background-work.js').drainBackgroundWork;

const SAVE = 'save:coinkeeper';
const LEDGER = 'ledger:currency:coinkeeper';
const BORN = 1_700_000_000_000;
const today = () => new Date().toISOString().slice(0, 10);

function saveRecord(version: number, balances: Rec = {}, extra: Rec = {}): Rec {
    return {
        _saveVersion: version,
        character: { name: 'Coinkeeper', createdAt: BORN, ryo: 1_000, bankRyo: 0, fateShards: 3, ...balances },
        ...extra,
    };
}

/** A store that records which primitives a commit used. */
function spied(store: Store) {
    const calls: string[] = [];
    const wrapped: Store = {
        ...store,
        get: (key) => { calls.push(`get:${key}`); return store.get(key); },
        compareSet: (key, expected, value, options) => { calls.push(`compareSet:${key}`); return store.compareSet(key, expected, value, options); },
        compareSetMany: (ops) => { calls.push(`compareSetMany:${ops.map((op) => op.key).join(',')}`); return store.compareSetMany!(ops); },
    };
    return { store: wrapped, calls };
}

async function counter(event: string): Promise<number> {
    await drainBackgroundWork();
    return Number(await storage.kv.get(`telemetry:currency-ledger:${event}:${today()}`)) || 0;
}

before(async () => {
    storage = await import('../_storage.js');
    commitMod = await import('./_commit-player-save.js');
    ledgerMod = await import('../_currency-ledger.js');
    ({ drainBackgroundWork } = await import('../_background-work.js'));
});

let store: Store;
beforeEach(() => { store = storage._makeMemoryKv(); });
afterEach(() => {
    delete process.env.DISABLE_CURRENCY_LEDGER_ATOMIC;
    delete process.env.DISABLE_CURRENCY_LEDGER_GATE;
});

const commit = (s: Store, expected: Rec | null, intended: Rec, opts: Parameters<typeof commitMod.commitPlayerSaveRecord>[2] = {}) =>
    commitMod.commitPlayerSaveRecord(s, { playerName: 'Coinkeeper', saveKey: SAVE, expected, intended }, opts);

describe('fast path — currency did not move', () => {
    test('one compare-and-set, no ledger read or write', async () => {
        const before = saveRecord(4);
        await store.set(SAVE, before);
        const { store: s, calls } = spied(store);
        const next = { ...saveRecord(5), character: { ...(before.character as Rec), level: 12 } };
        assert.equal(await commit(s, before, next), true);
        assert.deepEqual(calls, [`compareSet:${SAVE}`]);
        assert.equal(await store.get(LEDGER), null);
    });

    test('a stale expected is refused exactly as before', async () => {
        await store.set(SAVE, saveRecord(5));
        assert.equal(await commit(store, saveRecord(4), saveRecord(6)), false);
        assert.deepEqual(await store.get(SAVE), saveRecord(5));
    });
});

describe('money writes — save and ledger in one transaction', () => {
    test('a missing row is created from the balances being written', async () => {
        const createdBefore = await counter('ledger-created');
        const before = saveRecord(4);
        await store.set(SAVE, before);
        const { store: s, calls } = spied(store);
        const after = saveRecord(5, { ryo: 750 });
        assert.equal(await commit(s, before, after, { now: 99 }), true);
        assert.deepEqual(calls, [`get:${LEDGER}`, `compareSetMany:${SAVE},${LEDGER}`]);
        assert.deepEqual(await store.get(SAVE), after);
        assert.deepEqual(await store.get(LEDGER), {
            v: 2, name: 'coinkeeper', bornAt: BORN, saveVersion: 5, seq: 1,
            balances: { ryo: 750, bankRyo: 0, fateShards: 3 }, updatedAt: 99,
        });
        assert.equal(await counter('ledger-created'), createdBefore + 1);
    });

    test('a first save carrying starting currency creates both rows', async () => {
        const first = saveRecord(1, { ryo: 100 });
        assert.equal(await commit(store, null, first), true);
        assert.deepEqual(await store.get(SAVE), first);
        assert.equal((await store.get<Rec>(LEDGER))?.saveVersion, 1);
    });

    test('a v1 projection row is upgraded in place', async () => {
        const upgradedBefore = await counter('ledger-upgraded');
        const before = saveRecord(4);
        await store.set(SAVE, before);
        await store.set(LEDGER, { name: 'coinkeeper', saveVersion: 4, balances: { ryo: 1_000, bankRyo: 0, fateShards: 3 }, updatedAt: 1 });
        assert.equal(await commit(store, before, saveRecord(5, { ryo: 900 })), true);
        const row = await store.get<Rec>(LEDGER);
        assert.equal(row?.v, 2);
        assert.equal(row?.seq, 1);
        assert.deepEqual(row?.balances, { ryo: 900, bankRyo: 0, fateShards: 3 });
        assert.equal(await counter('ledger-upgraded'), upgradedBefore + 1);
    });

    test('consecutive money writes keep the ledger matched and counting', async () => {
        let current = saveRecord(4);
        await store.set(SAVE, current);
        for (const [version, ryo] of [[5, 900], [6, 800], [7, 1_200]] as const) {
            const next = saveRecord(version, { ryo });
            assert.equal(await commit(store, current, next), true);
            current = next;
        }
        const row = await store.get<Rec>(LEDGER);
        assert.equal(row?.seq, 3);
        assert.equal(ledgerMod.classifyCurrencyLedger(current, row), 'match');
    });

    test('a moved save refuses the write and leaves the ledger untouched', async () => {
        const before = saveRecord(4);
        await store.set(SAVE, saveRecord(5, { ryo: 1 }));
        const { store: s, calls } = spied(store);
        assert.equal(await commit(s, before, saveRecord(5, { ryo: 500 })), false);
        assert.equal(await store.get(LEDGER), null, 'no ledger row without its save');
        assert.equal(calls.filter((c) => c.startsWith('compareSetMany')).length, 1, 'a moved save is not retried here');
    });

    test('a ledger row that alone moved under the held lock is re-read and the write retried once', async () => {
        const raceBefore = await counter('ledger-race');
        const before = saveRecord(4);
        await store.set(SAVE, before);
        await store.set(LEDGER, ledgerMod.buildCurrencyLedgerRow('coinkeeper', before, null));
        let moved = false;
        const racing: Store = {
            ...store,
            compareSetMany: async (ops) => {
                if (!moved) {
                    moved = true;
                    // An older process's best-effort projection lands first.
                    await store.set(LEDGER, { name: 'coinkeeper', saveVersion: 4, balances: { ryo: 1_000, bankRyo: 0, fateShards: 3 }, updatedAt: 2 });
                }
                return store.compareSetMany!(ops);
            },
        };
        assert.equal(await commit(racing, before, saveRecord(5, { ryo: 640 })), true);
        assert.deepEqual((await store.get<Rec>(LEDGER))?.balances, { ryo: 640, bankRyo: 0, fateShards: 3 });
        assert.equal(await counter('ledger-race'), raceBefore + 1);
    });

    test('a ledger that keeps moving gives up after the retry with nothing written', async () => {
        const before = saveRecord(4);
        await store.set(SAVE, before);
        const flapping: Store = {
            ...store,
            compareSetMany: async (ops) => {
                await store.set(LEDGER, { name: 'coinkeeper', saveVersion: 4, balances: {}, updatedAt: Math.random() });
                return store.compareSetMany!(ops);
            },
        };
        assert.equal(await commit(flapping, before, saveRecord(5, { ryo: 1 })), false);
        assert.deepEqual(await store.get(SAVE), before);
    });
});

describe('classification at commit time', () => {
    test('an orphan row from a deleted account of the same name is replaced', async () => {
        const orphanBefore = await counter('ledger-orphan');
        const before = saveRecord(2);
        await store.set(SAVE, before);
        await store.set(LEDGER, { ...ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(30, { ryo: 99_999 })), bornAt: 12 });
        assert.equal(await commit(store, before, saveRecord(3, { ryo: 10 })), true);
        const row = await store.get<Rec>(LEDGER);
        assert.equal(row?.bornAt, BORN);
        assert.equal(row?.seq, 1, 'the dead account\'s counter is not inherited');
        assert.deepEqual(row?.balances, { ryo: 10, bankRyo: 0, fateShards: 3 });
        assert.equal(await counter('ledger-orphan'), orphanBefore + 1);
    });

    test('a row ahead of a restored save loses to the save', async () => {
        const aheadBefore = await counter('ledger-ahead');
        const restored = saveRecord(5, { ryo: 300 });
        await store.set(SAVE, restored);
        await store.set(LEDGER, ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(9, { ryo: 5 }), null));
        assert.equal(await commit(store, restored, saveRecord(6, { ryo: 250 })), true);
        assert.deepEqual((await store.get<Rec>(LEDGER))?.balances, { ryo: 250, bankRyo: 0, fateShards: 3 });
        assert.equal(await counter('ledger-ahead'), aheadBefore + 1);
    });

    test('a writer that moved currency without the helper is counted and the save wins', async () => {
        const laggingBefore = await counter('ledger-lagging-different');
        await store.set(LEDGER, ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(4), null));
        const bypassed = saveRecord(5, { ryo: 4_000 }); // a raw writer paid 3,000 ryo
        await store.set(SAVE, bypassed);
        assert.equal(await commit(store, bypassed, saveRecord(6, { ryo: 3_900 })), true);
        assert.deepEqual((await store.get<Rec>(LEDGER))?.balances, { ryo: 3_900, bankRyo: 0, fateShards: 3 });
        assert.equal(await counter('ledger-lagging-different'), laggingBefore + 1);
    });

    test('divergence is report-only by default: counted, logged, and the save wins', async () => {
        const divergentBefore = await counter('ledger-divergent');
        const before = saveRecord(4, { ryo: 1_000 });
        await store.set(SAVE, before);
        await store.set(LEDGER, ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(4, { ryo: 999 }), null));
        assert.equal(commitMod.CURRENCY_LEDGER_GATE_ENFORCED, false, 'the fail-closed step has not been taken yet');
        assert.equal(await commit(store, before, saveRecord(5, { ryo: 900 })), true);
        assert.deepEqual((await store.get<Rec>(LEDGER))?.balances, { ryo: 900, bankRyo: 0, fateShards: 3 });
        assert.equal(await counter('ledger-divergent'), divergentBefore + 1);
    });

    test('once enforced, divergence refuses the money write and writes nothing', async () => {
        const before = saveRecord(4, { ryo: 1_000 });
        const ledger = ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(4, { ryo: 999 }), null);
        await store.set(SAVE, before);
        await store.set(LEDGER, ledger);
        await assert.rejects(commit(store, before, saveRecord(5, { ryo: 900 }), { gateEnforced: true }), commitMod.CurrencyLedgerDivergenceError);
        assert.deepEqual(await store.get(SAVE), before);
        assert.deepEqual(await store.get(LEDGER), ledger);
    });

    test('DISABLE_CURRENCY_LEDGER_GATE=1 lets the save win even when enforced', async () => {
        process.env.DISABLE_CURRENCY_LEDGER_GATE = '1';
        const before = saveRecord(4, { ryo: 1_000 });
        await store.set(SAVE, before);
        await store.set(LEDGER, ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(4, { ryo: 999 }), null));
        assert.equal(await commit(store, before, saveRecord(5, { ryo: 900 }), { gateEnforced: true }), true);
        assert.deepEqual(await store.get(SAVE), saveRecord(5, { ryo: 900 }));
    });
});

describe('fallbacks', () => {
    test('DISABLE_CURRENCY_LEDGER_ATOMIC=1 commits the save alone, then projects best-effort', async () => {
        process.env.DISABLE_CURRENCY_LEDGER_ATOMIC = '1';
        const before = saveRecord(4);
        await store.set(SAVE, before);
        const { store: s, calls } = spied(store);
        assert.equal(await commit(s, before, saveRecord(5, { ryo: 10 })), true);
        assert.equal(calls.some((c) => c.startsWith('compareSetMany')), false);
        assert.equal(calls[0], `compareSet:${SAVE}`);
        const row = await store.get<Rec>(LEDGER);
        assert.equal(row?.v, 2, 'the best-effort projection writes the same row shape');
        assert.equal(ledgerMod.classifyCurrencyLedger(saveRecord(5, { ryo: 10 }), row), 'match');
    });

    test('a store without multi-key support (a test fake) gets the plain compare-and-set', async () => {
        const before = saveRecord(4);
        let stored: unknown = before;
        const fake = {
            get: async <T>() => stored as T,
            compareSet: async (_key: string, _expected: unknown, value: unknown) => { stored = value; return true; },
        };
        assert.equal(await commit(fake as unknown as Store, before, saveRecord(5, { ryo: 1 })), true);
        assert.deepEqual(stored, saveRecord(5, { ryo: 1 }));
    });

    test('a transport error propagates unchanged so the caller\'s read-back decides', async () => {
        const before = saveRecord(4);
        await store.set(SAVE, before);
        const broken: Store = { ...store, compareSetMany: async () => { throw new Error('reply-lost'); } };
        await assert.rejects(commit(broken, before, saveRecord(5, { ryo: 1 })), /reply-lost/);
    });
});

describe('deploy overlap', () => {
    test('an old process\'s v1 projection between new commits never reads as divergence', async () => {
        const divergentBefore = await counter('ledger-divergent');
        let current = saveRecord(4);
        await store.set(SAVE, current);
        const v5 = saveRecord(5, { ryo: 900 });
        assert.equal(await commit(store, current, v5), true);
        current = v5;

        // The previous deploy, still draining, commits v6 its own way: a
        // plain save write followed by its v1 projection.
        const v6 = saveRecord(6, { ryo: 850 });
        await store.set(SAVE, v6);
        await store.set(LEDGER, { name: 'coinkeeper', saveVersion: 6, balances: { ryo: 850, bankRyo: 0, fateShards: 3 }, updatedAt: 3 });
        current = v6;

        const v7 = saveRecord(7, { ryo: 800 });
        assert.equal(await commit(store, current, v7), true);
        const row = await store.get<Rec>(LEDGER);
        assert.equal(row?.v, 2, 'the v1 row is upgraded, not trusted');
        assert.equal(ledgerMod.classifyCurrencyLedger(v7, row), 'match');
        assert.equal(await counter('ledger-divergent'), divergentBefore, 'no false divergence');
    });

    test('a v1 reader (the old code) still reads a v2 row', () => {
        const row = ledgerMod.buildCurrencyLedgerRow('coinkeeper', saveRecord(8, { ryo: 5 }), null);
        assert.deepEqual(ledgerMod.compareLedger(saveRecord(8, { ryo: 5 }), row), { status: 'match' });
        assert.deepEqual(ledgerMod.compareLedger(saveRecord(9, { ryo: 5 }), row).status, 'stale');
    });
});
