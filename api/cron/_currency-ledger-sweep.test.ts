import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * The currency-ledger sweep: the backfill and orphan cleanup that reaches the
 * players a money write has not touched since the ledger shipped. Every repair
 * is built from the save and asserts that exact save in the same transaction.
 */

type Store = import('../_storage.js').KvLike;
type Rec = Record<string, unknown>;

let storage: typeof import('../_storage.js');
let sweep: typeof import('./_currency-ledger-sweep.js');
let ledgerMod: typeof import('../_currency-ledger.js');

const BORN = 1_700_000_000_000;
const save = (version: number, balances: Rec = {}, createdAt: number | null = BORN): Rec => ({
    _saveVersion: version,
    character: { name: 'p', ...(createdAt === null ? {} : { createdAt }), ryo: 100, fateShards: 1, ...balances },
});

before(async () => {
    storage = await import('../_storage.js');
    sweep = await import('./_currency-ledger-sweep.js');
    ledgerMod = await import('../_currency-ledger.js');
});

let store: Store;
beforeEach(() => { store = storage._makeMemoryKv(); });

const row = (name: string, record: Rec, prior: unknown = null) => ledgerMod.buildCurrencyLedgerRow(name, record, prior, 1);
const ledgerOf = (name: string) => store.get<Rec>(`ledger:currency:${name}`);

describe('reconcileCurrencyLedger', () => {
    test('creates a missing row from the save, and leaves a matching row alone', async () => {
        await store.set('save:aki', save(4, { ryo: 750 }));
        assert.deepEqual(await sweep.reconcileCurrencyLedger('aki', { store }), { name: 'aki', status: 'missing', action: 'written' });
        const created = await ledgerOf('aki');
        assert.deepEqual(created?.balances, { ryo: 750, fateShards: 1 });
        assert.equal(created?.saveVersion, 4);
        assert.deepEqual(await sweep.reconcileCurrencyLedger('aki', { store }), { name: 'aki', status: 'match', action: 'none' });
        assert.deepEqual(await ledgerOf('aki'), created, 'an idempotent pass writes nothing');
    });

    test('upgrades a v1 projection row and repairs a row a raw writer left behind', async () => {
        await store.set('save:ban', save(6, { ryo: 40 }));
        await store.set('ledger:currency:ban', { name: 'ban', saveVersion: 6, balances: { ryo: 40, fateShards: 1 }, updatedAt: 1 });
        assert.equal((await sweep.reconcileCurrencyLedger('ban', { store })).status, 'legacy');
        assert.equal((await ledgerOf('ban'))?.v, 2);

        await store.set('save:cho', save(9, { ryo: 4_000 }));
        await store.set('ledger:currency:cho', row('cho', save(7, { ryo: 100 })));
        assert.deepEqual(await sweep.reconcileCurrencyLedger('cho', { store }), { name: 'cho', status: 'lagging-different', action: 'written' });
        assert.deepEqual((await ledgerOf('cho'))?.balances, { ryo: 4_000, fateShards: 1 });
    });

    test('a lagging row with the same balances is normal and left alone', async () => {
        await store.set('save:dai', save(12));
        const lagging = row('dai', save(9));
        await store.set('ledger:currency:dai', lagging);
        assert.deepEqual(await sweep.reconcileCurrencyLedger('dai', { store }), { name: 'dai', status: 'lagging', action: 'none' });
        assert.deepEqual(await ledgerOf('dai'), lagging);
    });

    test('removes a row whose save is gone', async () => {
        await store.set('ledger:currency:gone', row('gone', save(3)));
        assert.deepEqual(await sweep.reconcileCurrencyLedger('gone', { store }), { name: 'gone', status: 'orphan', action: 'removed' });
        assert.equal(await ledgerOf('gone'), null);
    });

    test('replaces a row from a deleted account whose name was reused, restarting its counter', async () => {
        await store.set('save:eri', save(2, { ryo: 5 }));
        await store.set('ledger:currency:eri', { ...row('eri', save(40, { ryo: 99_999 })), bornAt: 7, seq: 30 });
        assert.equal((await sweep.reconcileCurrencyLedger('eri', { store })).status, 'orphan');
        const replaced = await ledgerOf('eri');
        assert.equal(replaced?.seq, 1);
        assert.equal(replaced?.bornAt, BORN);
        assert.deepEqual(replaced?.balances, { ryo: 5, fateShards: 1 });
    });

    test('repairs a divergent row while report-only, and holds it once the gate is enforced', async () => {
        await store.set('save:fuu', save(5, { ryo: 1_000 }));
        const divergent = row('fuu', save(5, { ryo: 999 }));
        await store.set('ledger:currency:fuu', divergent);
        assert.deepEqual(await sweep.reconcileCurrencyLedger('fuu', { store, gateEnforced: true }), { name: 'fuu', status: 'divergent', action: 'held' });
        assert.deepEqual(await ledgerOf('fuu'), divergent, 'held rows keep their evidence');
        assert.deepEqual(await sweep.reconcileCurrencyLedger('fuu', { store }), { name: 'fuu', status: 'divergent', action: 'written' });
        assert.deepEqual((await ledgerOf('fuu'))?.balances, { ryo: 1_000, fateShards: 1 });
    });

    test('never writes a ledger for a save that moved under the repair', async () => {
        await store.set('save:gin', save(3, { ryo: 10 }));
        const racing: Store = {
            ...store,
            compareSetMany: async (ops) => {
                await store.set('save:gin', save(4, { ryo: 20 })); // a writer lands first
                return store.compareSetMany!(ops);
            },
        };
        assert.deepEqual(await sweep.reconcileCurrencyLedger('gin', { store: racing }), { name: 'gin', status: 'missing', action: 'raced' });
        assert.equal(await ledgerOf('gin'), null);
    });
});

describe('runCurrencyLedgerSweep', () => {
    test('walks the population in bounded batches, skipping non-player saves, and wraps', async () => {
        for (const name of ['ann', 'bea', 'cal', 'dov', 'eve']) await store.set(`save:${name}`, save(2));
        await store.set('save:clan-stormpetals', { members: [] });
        await store.set('save:admin1', { character: { ryo: 1 } });
        await store.set('ledger:currency:zed', row('zed', save(1)));

        const first = await sweep.runCurrencyLedgerSweep({ store, batch: 4 });
        assert.equal(first.scanned, 4);
        assert.equal(first.written, 4);
        assert.equal(first.cursor, 'dov');
        assert.equal(first.wrapped, false);

        const second = await sweep.runCurrencyLedgerSweep({ store, batch: 4 });
        assert.equal(second.written, 1, 'eve');
        assert.equal(second.removed, 1, 'zed has no save');
        assert.equal(second.wrapped, true);

        assert.equal(await store.get('ledger:currency:clan-stormpetals'), null);
        assert.equal(await store.get('ledger:currency:admin1'), null);
        assert.equal(await store.get('ledger:currency:zed'), null);

        const third = await sweep.runCurrencyLedgerSweep({ store, batch: 10 });
        assert.equal(third.written + third.removed, 0, 'a converged population costs no writes');
        assert.equal(third.scanned, 5);
    });

    test('isPlayerSaveName keeps clan blobs, admin slots, probes and legacy spellings out', () => {
        assert.equal(sweep.isPlayerSaveName('rill'), true);
        assert.equal(sweep.isPlayerSaveName('night_owl-7'), true);
        assert.equal(sweep.isPlayerSaveName('clan-storm'), false);
        assert.equal(sweep.isPlayerSaveName('admin1'), false);
        assert.equal(sweep.isPlayerSaveName('health-probe-1'), false);
        assert.equal(sweep.isPlayerSaveName('Rill'), false, 'pre-safeName key');
        assert.equal(sweep.isPlayerSaveName('Admin 1'), false, 'pre-safeName admin slot');
        assert.equal(sweep.isPlayerSaveName(''), false);
    });

    test('reconcile refuses a legacy name instead of reconciling (and possibly deleting) the lowercase row', async () => {
        await store.set('save:Rill', save(9));
        const row = ledgerMod.buildCurrencyLedgerRow('Rill', save(9), null, 1);
        await store.set('ledger:currency:rill', row);
        assert.deepEqual(await sweep.reconcileCurrencyLedger('Rill', { store }), { name: 'Rill', status: 'no-save', action: 'skipped' });
        assert.deepEqual(await store.get('ledger:currency:rill'), row, 'the row the legacy save owns survives');
    });

    test('a ledger row whose save exists only under a legacy spelling is neither reconciled nor removed', async () => {
        // Ledger keys are always lowercase. Treating this row as an orphan would
        // delete it on every pass and have the next money write recreate it.
        await store.set('save:Rill', save(9));
        const row = ledgerMod.buildCurrencyLedgerRow('Rill', save(9), null, 1);
        await store.set('ledger:currency:rill', row);
        const result = await sweep.runCurrencyLedgerSweep({ store, batch: 10 });
        assert.equal(result.scanned, 0);
        assert.equal(result.removed, 0);
        assert.deepEqual(await store.get('ledger:currency:rill'), row);
    });
});
