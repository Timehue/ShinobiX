import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _makeMemoryKv } from './_storage.js';
import {
    CURRENCY_LEDGER_FIELDS,
    currencyLedgerKey,
    projectBalances,
    balancesDiffer,
    compareLedger,
    syncCurrencyLedger,
    readCurrencyLedger,
    decreaseOnlyCurrencyDrops,
    recordCurrencyLedgerEvent,
    currencyLedgerTelemetryKey,
    readCurrencyLedgerTelemetry,
    CURRENCY_LEDGER_EVENTS,
    buildCurrencyLedgerRow,
    classifyCurrencyLedger,
    type CurrencyLedger,
} from './_currency-ledger.js';
import { SAVE_FIELD_CONTRACT } from './save/_state-ownership.js';

/*
 * P0-5: the currency ledger side-car. It must be a faithful, monotonic
 * projection that costs nothing when currency did not move, can never fail a
 * save, and reports the one signal a read cutover depends on — same
 * saveVersion, different balances.
 */

const record = (over: { version?: number; balances?: Record<string, unknown> } = {}) => ({
    _saveVersion: over.version ?? 5,
    character: {
        name: 'LedgerProbe', level: 20,
        ryo: 1_000, bankRyo: 500, honorSeals: 3, fateShards: 2, boneCharms: 1,
        auraStones: 0, auraDust: 0, mythicSeals: 0, hollowShards: 0,
        ...(over.balances ?? {}),
    } as Record<string, unknown>,
});

describe('tracked field set', () => {
    it('derives from the ownership manifest — the ten balances, no stamps or logs', () => {
        assert.deepEqual([...CURRENCY_LEDGER_FIELDS], [
            'ryo', 'bankRyo', 'honorSeals', 'fateShards', 'chroniclePoints', 'boneCharms',
            'auraStones', 'auraDust', 'mythicSeals', 'hollowShards',
        ]);
        assert.ok(!CURRENCY_LEDGER_FIELDS.includes('lastBankInterestAt'), 'claim stamps are not balances');
        assert.ok(!CURRENCY_LEDGER_FIELDS.includes('bankLog'), 'the client-owned log is not a balance');
    });

    it('stays in step with the manifest automatically', () => {
        const expected = SAVE_FIELD_CONTRACT
            .filter((d) => d.scope === 'character' && d.domain === 'currency'
                && (d.category === 'server-ledger' || d.category === 'server-clamped'))
            .map((d) => d.field);
        assert.deepEqual([...CURRENCY_LEDGER_FIELDS], expected);
    });

    it('namespaces its keys away from saves', () => {
        assert.equal(currencyLedgerKey('Rill'), 'ledger:currency:rill');
        assert.ok(!currencyLedgerKey('Rill').startsWith('save:'));
    });
});

describe('projection', () => {
    it('normalizes to numbers and ignores untracked fields', () => {
        const balances = projectBalances({ ryo: '1200', bankRyo: 5, level: 40, nindo: 'hi' } as Record<string, unknown>);
        assert.equal(balances.ryo, 1_200);
        assert.equal(balances.bankRyo, 5);
        assert.ok(!('level' in balances) && !('nindo' in balances));
    });

    it('detects a difference on any tracked field', () => {
        const base = projectBalances(record().character);
        assert.equal(balancesDiffer(base, { ...base }), false);
        assert.equal(balancesDiffer(base, { ...base, mythicSeals: 1 }), true);
    });
});

describe('sync', () => {
    it('writes the projection with the version it came from', async () => {
        const kv = _makeMemoryKv();
        const ledger = await syncCurrencyLedger('LedgerProbe', record({ version: 7 }), { kv });
        assert.equal(ledger!.saveVersion, 7);
        assert.equal(ledger!.balances.ryo, 1_000);
        assert.equal((await readCurrencyLedger('LedgerProbe', { kv }))!.balances.bankRyo, 500);
    });

    it('skips entirely when the write did not move currency (the autosave case)', async () => {
        const kv = _makeMemoryKv();
        const previous = record().character;
        const result = await syncCurrencyLedger('LedgerProbe', record({ version: 6 }), { kv, previousCharacter: previous });
        assert.equal(result, null, 'no projection work for a currency-neutral save');
        assert.equal(await readCurrencyLedger('LedgerProbe', { kv }), null, 'and no write');
    });

    it('projects when currency moved', async () => {
        const kv = _makeMemoryKv();
        const previous = record().character;
        const next = record({ version: 6, balances: { ryo: 900 } });
        const ledger = await syncCurrencyLedger('LedgerProbe', next, { kv, previousCharacter: previous });
        assert.equal(ledger!.balances.ryo, 900);
    });

    it('never rolls the projection back to an older version', async () => {
        const kv = _makeMemoryKv();
        await syncCurrencyLedger('LedgerProbe', record({ version: 9, balances: { ryo: 5_000 } }), { kv });
        const out = await syncCurrencyLedger('LedgerProbe', record({ version: 4, balances: { ryo: 1 } }), { kv });
        assert.equal(out!.saveVersion, 9, 'an out-of-order sync is ignored');
        assert.equal((await readCurrencyLedger('LedgerProbe', { kv }))!.balances.ryo, 5_000);
    });

    it('can never fail the save it follows', async () => {
        const brokenKv = { get: async () => { throw new Error('kv down'); }, set: async () => 'OK' } as never;
        assert.equal(await syncCurrencyLedger('LedgerProbe', record(), { kv: brokenKv }), null);
    });
});

describe('divergence comparison — the cutover signal', () => {
    it('reports match when the projection agrees', () => {
        const rec = record({ version: 3 });
        const ledger: CurrencyLedger = { name: 'ledgerprobe', saveVersion: 3, balances: projectBalances(rec.character), updatedAt: 1 };
        assert.deepEqual(compareLedger(rec, ledger), { status: 'match' });
    });

    it('reports STALE (benign) when the ledger is simply behind', () => {
        const rec = record({ version: 8, balances: { ryo: 42 } });
        const ledger: CurrencyLedger = { name: 'ledgerprobe', saveVersion: 5, balances: projectBalances(record().character), updatedAt: 1 };
        const result = compareLedger(rec, ledger);
        assert.equal(result.status, 'stale', 'lag from an unhooked writer is not a bug');
    });

    it('reports DIVERGENT when the same version disagrees — the real bug', () => {
        const rec = record({ version: 4, balances: { ryo: 999 } });
        const ledger: CurrencyLedger = { name: 'ledgerprobe', saveVersion: 4, balances: { ...projectBalances(record().character) }, updatedAt: 1 };
        const result = compareLedger(rec, ledger);
        assert.equal(result.status, 'divergent');
        assert.deepEqual(result.status === 'divergent' ? result.fields : [], [{ field: 'ryo', blob: 999, ledger: 1_000 }]);
    });

    it('reports missing before the first projection', () => {
        assert.deepEqual(compareLedger(record(), null), { status: 'missing' });
    });
});

describe('decrease-only autosave measurement', () => {
    it('reports only the decrease-only currencies an autosave lowered', () => {
        const before = record().character;
        const after = { ...before, honorSeals: 1, boneCharms: 4, ryo: 10 };
        assert.deepEqual(decreaseOnlyCurrencyDrops(before, after), [
            { field: 'honorSeals', before: 3, after: 1 },
        ], 'a gain is not a drop, and ryo is server-owned (never in this list)');
    });

    it('ignores a field the stored character never had, and a missing side', () => {
        const before = { ryo: 5 } as Record<string, unknown>;
        assert.deepEqual(decreaseOnlyCurrencyDrops(before, { ryo: 5, auraDust: 0 }), []);
        assert.deepEqual(decreaseOnlyCurrencyDrops(null, { auraDust: 0 }), []);
        assert.deepEqual(decreaseOnlyCurrencyDrops(before, undefined), []);
    });
});

describe('telemetry', () => {
    it('counts one event per day under a namespaced key', async () => {
        const kv = _makeMemoryKv();
        const now = Date.UTC(2026, 9, 10, 12);
        await recordCurrencyLedgerEvent('autosave-decrease', { kv, now });
        await recordCurrencyLedgerEvent('autosave-decrease', { kv, now });
        const key = currencyLedgerTelemetryKey('autosave-decrease', new Date(now).toISOString());
        assert.equal(key, 'telemetry:currency-ledger:autosave-decrease:2026-10-10');
        assert.equal(Number(await kv.get(key)), 2);
    });

    it('reads back a fixed window per event, oldest day first, absent days as zero', async () => {
        const kv = _makeMemoryKv();
        const now = Date.UTC(2026, 9, 10, 12);
        await recordCurrencyLedgerEvent('autosave-decrease', { kv, now });
        await recordCurrencyLedgerEvent('autosave-decrease', { kv, now: now - 2 * 86_400_000 });
        const window = await readCurrencyLedgerTelemetry(3, { kv, now });
        assert.deepEqual(window['autosave-decrease'], [
            { date: '2026-10-08', count: 1 },
            { date: '2026-10-09', count: 0 },
            { date: '2026-10-10', count: 1 },
        ]);
        assert.deepEqual(Object.keys(window), [...CURRENCY_LEDGER_EVENTS], 'every counted event is reported');
    });

    it('can never fail or poison the write it describes', async () => {
        const broken = { incr: async () => { throw new Error('kv down'); } } as never;
        await assert.doesNotReject(recordCurrencyLedgerEvent('autosave-decrease', { kv: broken }));
    });
});

describe('write-path wiring', () => {
    it('the shared versioned writer commits the ledger with the save', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'save', '_mutate-player-save.ts'), 'utf8');
        assert.match(src, /await commitPlayerSaveRecord\(store, \{/);
        assert.doesNotMatch(src, /syncCurrencyLedger\(/, 'no separate post-commit projection remains');
    });

    it('the projected writer commits the ledger with the save', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'save', '_projected-write.ts'), 'utf8');
        assert.match(src, /await commitPlayerSaveRecord\(kv, \{/);
        assert.doesNotMatch(src, /syncCurrencyLedger\(/);
    });

    it('the generic save path commits the ledger for player saves only', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
        assert.match(src, /isClanSave\s*\?\s*await kv\.compareSet\(key, existing \?\? null, committedRecord\)\s*:\s*await commitPlayerSaveRecord\(kv, \{/s);
        assert.doesNotMatch(src, /syncCurrencyLedger\(/);
    });
});

describe('v2 rows and classification', () => {
    const save = (over: { version?: number; createdAt?: number | null; balances?: Record<string, unknown> } = {}) => {
        const base = record({ version: over.version ?? 5, balances: over.balances });
        if (over.createdAt !== null) base.character.createdAt = over.createdAt ?? 1_700_000_000_000;
        return base;
    };

    it('builds a v2 row that a v1 reader still understands', () => {
        const row = buildCurrencyLedgerRow('LedgerProbe', save({ version: 7 }), null, 42);
        assert.deepEqual(row, {
            v: 2, name: 'ledgerprobe', bornAt: 1_700_000_000_000, saveVersion: 7, seq: 1,
            balances: projectBalances(save().character), updatedAt: 42,
        });
        assert.deepEqual(compareLedger(save({ version: 7 }), row), { status: 'match' }, 'the v1 comparison reads a v2 row');
        assert.equal(buildCurrencyLedgerRow('LedgerProbe', save({ version: 8 }), row).seq, 2, 'the write counter continues');
        assert.equal(buildCurrencyLedgerRow('LedgerProbe', save({ version: 8 }), { saveVersion: 7, balances: {} }).seq, 1, 'a v1 row restarts it');
    });

    it('classifies every state a stored row can be in', () => {
        const v2 = (over: Partial<ReturnType<typeof buildCurrencyLedgerRow>> = {}) => ({ ...buildCurrencyLedgerRow('p', save()), ...over });
        assert.equal(classifyCurrencyLedger(save(), null), 'missing');
        assert.equal(classifyCurrencyLedger(save(), { saveVersion: 5, balances: {} }), 'legacy');
        assert.equal(classifyCurrencyLedger(null, v2()), 'orphan', 'a row with no save at all');
        assert.equal(classifyCurrencyLedger(save(), v2({ bornAt: 1 })), 'orphan', 'another account of the same name');
        assert.equal(classifyCurrencyLedger(save(), v2({ saveVersion: 6 })), 'ahead');
        assert.equal(classifyCurrencyLedger(save({ version: 9 }), v2()), 'lagging');
        assert.equal(classifyCurrencyLedger(save({ version: 9, balances: { ryo: 1 } }), v2()), 'lagging-different');
        assert.equal(classifyCurrencyLedger(save(), v2()), 'match');
        assert.equal(classifyCurrencyLedger(save({ balances: { ryo: 1 } }), v2()), 'divergent');
    });

    it('does not call a legacy save that has just gained createdAt an orphan', () => {
        const unborn = buildCurrencyLedgerRow('p', save({ createdAt: null }));
        assert.equal(unborn.bornAt, null);
        assert.equal(classifyCurrencyLedger(save({ version: 6 }), unborn), 'lagging');
    });

    it('syncCurrencyLedger writes v2 rows and replaces an orphan instead of honouring its version', async () => {
        const kv = _makeMemoryKv();
        await kv.set(currencyLedgerKey('LedgerProbe'), { ...buildCurrencyLedgerRow('LedgerProbe', save({ version: 40 })), bornAt: 1 });
        const out = await syncCurrencyLedger('LedgerProbe', save({ version: 3, balances: { ryo: 7 } }), { kv });
        assert.equal(out!.v, 2);
        assert.equal(out!.saveVersion, 3, 'a dead account\'s higher version does not block the new account');
        assert.equal(out!.balances.ryo, 7);
    });
});
