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
    it('derives from the ownership manifest — the nine balances, no stamps or logs', () => {
        assert.deepEqual([...CURRENCY_LEDGER_FIELDS], [
            'ryo', 'bankRyo', 'honorSeals', 'fateShards', 'boneCharms',
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

describe('write-path wiring', () => {
    it('the shared versioned writer projects the ledger', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'save', '_mutate-player-save.ts'), 'utf8');
        assert.match(src, /syncCurrencyLedger\(/);
        assert.match(src, /previousCharacter/, 'the previous character must be passed so a no-op write costs nothing');
    });

    it('the generic save path projects the ledger for player saves only', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'save', '[name].ts'), 'utf8');
        assert.match(src, /if \(!isClanSave\) \{\s*await syncCurrencyLedger\(/s);
    });
});
