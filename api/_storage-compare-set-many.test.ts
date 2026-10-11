import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';

/*
 * kv.compareSetMany — the all-or-nothing multi-key compare-and-set that lets a
 * money move commit every row it touches in one Postgres transaction (P0-5,
 * concurrency audit F9). Exercised against the real pgKv adapter over a
 * transactional query shim (the same technique as _storage-lock-fencing.test.ts)
 * and against the in-memory store the QA harness and e2e suites run on.
 */

process.env.DATABASE_URL = 'postgresql://csm-test:csm-test@127.0.0.1/csm-test';
delete process.env.SHINOBIX_QA_MEMORY_KV;

type Row = { value: unknown; expiresAt: string | null };
type Client = { id: number; pending: Map<string, Row | null>; released: boolean };
const rows = new Map<string, Row>();
const commands: Array<{ text: string; params: unknown[]; client: number | null }> = [];
const originalQuery = pg.Pool.prototype.query;
const originalConnect = pg.Pool.prototype.connect;
const originalEnd = pg.Pool.prototype.end;
const originalNow = Date.now;
let clock = originalNow();
let nextClient = 1;
let loseCommit = false;
let failStatement: RegExp | undefined;
let storage: typeof import('./_storage.js');
let locks: typeof import('./_lock.js');

/** jsonb equality: structural, object key order ignored. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
const jsonbEqual = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const live = (row: Row | null | undefined): row is Row => !!row && (!row.expiresAt || new Date(row.expiresAt).getTime() > clock);

async function query(sql: unknown, params: unknown[] = [], client?: Client) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    commands.push({ text, params, client: client?.id ?? null });
    if (failStatement?.test(text)) { failStatement = undefined; throw new Error('statement failed'); }
    const key = String(params[0] ?? '');
    const current = (item: string) => (client?.pending.has(item) ? client.pending.get(item) : rows.get(item));
    const write = (item: string, row: Row | null) => {
        if (client) client.pending.set(item, row);
        else if (row) rows.set(item, row);
        else rows.delete(item);
    };
    if (text === 'BEGIN') return { rows: [], rowCount: 0 };
    if (text === 'ROLLBACK') { client?.pending.clear(); return { rows: [], rowCount: 0 }; }
    if (text === 'COMMIT') {
        for (const [item, row] of client!.pending) { if (row) rows.set(item, row); else rows.delete(item); }
        client!.pending.clear();
        if (loseCommit) { loseCommit = false; throw new Error('lost COMMIT response'); }
        return { rows: [], rowCount: 0 };
    }
    if (text.includes('ORDER BY key FOR SHARE')) {
        const found = (params[0] as string[]).flatMap(item => {
            const row = rows.get(item);
            return row ? [{ key: item, value: structuredClone(row.value), live: live(row) }] : [];
        });
        return { rows: found, rowCount: found.length };
    }
    if (text.startsWith('SELECT public.kv_set_nx')) {
        const available = !live(current(key));
        if (available) write(key, { value: JSON.parse(String(params[1])), expiresAt: params[2] as string | null });
        return { rows: [{ kv_set_nx: available }], rowCount: 1 };
    }
    if (text.startsWith('SELECT value, expires_at')) {
        const row = current(key);
        return { rows: row ? [{ value: structuredClone(row.value), expires_at: row.expiresAt }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('INSERT INTO public.kv_store AS current')) {
        const row = current(key);
        if (live(row)) return { rows: [], rowCount: 0 };
        write(key, { value: JSON.parse(String(params[1])), expiresAt: params[2] as string | null });
        return { rows: [{ swapped: true }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO public.kv_store')) {
        write(key, { value: JSON.parse(String(params[1])), expiresAt: params[2] as string | null });
        return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE public.kv_store')) {
        const row = current(key);
        if (!live(row) || !jsonbEqual(row.value, JSON.parse(String(params[1])))) return { rows: [], rowCount: 0 };
        write(key, { value: JSON.parse(String(params[2])), expiresAt: params[3] as string | null });
        return { rows: [{ swapped: true }], rowCount: 1 };
    }
    if (text.startsWith('DELETE FROM public.kv_store') && text.includes('RETURNING true AS deleted')) {
        const row = current(key);
        if (!live(row) || !jsonbEqual(row.value, JSON.parse(String(params[1])))) return { rows: [], rowCount: 0 };
        write(key, null);
        return { rows: [{ deleted: true }], rowCount: 1 };
    }
    if (text.startsWith('DELETE FROM public.kv_store WHERE key = $1 AND value')) {
        const deleted = jsonbEqual(current(key)?.value, JSON.parse(String(params[1])));
        if (deleted) write(key, null);
        return { rows: [], rowCount: deleted ? 1 : 0 };
    }
    if (text.startsWith('SELECT NOT EXISTS')) {
        return { rows: [{ absent: !live(current(key)) }], rowCount: 1 };
    }
    if (text.startsWith('SELECT true AS held')) {
        const row = current(key);
        const held = live(row) && jsonbEqual(row.value, JSON.parse(String(params[1])));
        return { rows: held ? [{ held: true }] : [], rowCount: held ? 1 : 0 };
    }
    throw new Error(`Unexpected test SQL: ${text}`);
}

before(async () => {
    Date.now = () => clock;
    pg.Pool.prototype.query = ((sql: unknown, params?: unknown[]) => query(sql, params)) as typeof pg.Pool.prototype.query;
    pg.Pool.prototype.connect = (async () => {
        const client: Client = { id: nextClient++, pending: new Map(), released: false };
        return {
            query: (sql: unknown, params?: unknown[]) => query(sql, params, client),
            release: () => { assert.equal(client.released, false, 'a client is released exactly once'); client.released = true; },
        };
    }) as unknown as typeof pg.Pool.prototype.connect;
    pg.Pool.prototype.end = (async () => undefined) as typeof pg.Pool.prototype.end;
    storage = await import('./_storage.js');
    locks = await import('./_lock.js');
});

beforeEach(() => {
    rows.clear(); commands.length = 0; loseCommit = false; failStatement = undefined;
});

after(async () => {
    await storage.closeStoragePool();
    Date.now = originalNow;
    pg.Pool.prototype.query = originalQuery;
    pg.Pool.prototype.connect = originalConnect;
    pg.Pool.prototype.end = originalEnd;
});

const critical = { failClosed: true, maxAttempts: 1, baseBackoffMs: 1 };
const seed = (key: string, value: unknown, expiresAt: string | null = null) => rows.set(key, { value: structuredClone(value), expiresAt });
const valueOf = (key: string) => rows.get(key)?.value;
const mutations = () => commands.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.text) && !c.text.includes('lock:'));

describe('pgKv.compareSetMany', () => {
    test('commits every operation together in one transaction', async () => {
        seed('save:alpha', { _saveVersion: 4, character: { ryo: 100 } });
        seed('ledger:currency:alpha', { v: 2, balances: { ryo: 100 } });
        seed('trade:pending:t1', { state: 'open' });
        seed('economy-tx:t1', { state: 'reserved' });

        const ok = await storage.kv.compareSetMany!([
            { op: 'cas', key: 'save:alpha', expected: { character: { ryo: 100 }, _saveVersion: 4 }, value: { _saveVersion: 5, character: { ryo: 40 } } },
            { op: 'cas', key: 'ledger:currency:alpha', expected: { v: 2, balances: { ryo: 100 } }, value: { v: 2, balances: { ryo: 40 } } },
            { op: 'cas', key: 'save:beta', expected: null, value: { _saveVersion: 1, character: { ryo: 60 } } },
            { op: 'delete', key: 'trade:pending:t1', expected: { state: 'open' } },
            { op: 'assert', key: 'economy-tx:t1', expected: { state: 'reserved' } },
        ]);

        assert.equal(ok, true);
        assert.deepEqual(valueOf('save:alpha'), { _saveVersion: 5, character: { ryo: 40 } }, 'expected matches regardless of key order (jsonb)');
        assert.deepEqual(valueOf('ledger:currency:alpha'), { v: 2, balances: { ryo: 40 } });
        assert.deepEqual(valueOf('save:beta'), { _saveVersion: 1, character: { ryo: 60 } });
        assert.equal(rows.has('trade:pending:t1'), false);
        assert.deepEqual(valueOf('economy-tx:t1'), { state: 'reserved' }, 'an assert writes nothing');
        const clients = new Set(commands.map(c => c.client));
        assert.equal(clients.size, 1, 'one connection carries the whole batch');
        assert.deepEqual(commands.filter(c => c.text === 'BEGIN' || c.text === 'COMMIT').map(c => c.text), ['BEGIN', 'COMMIT']);
    });

    test('one moved predecessor refuses the whole batch — nothing applied, false returned', async () => {
        seed('save:alpha', { _saveVersion: 4, character: { ryo: 100 } });
        seed('save:beta', { _saveVersion: 9, character: { ryo: 5 } });

        const ok = await storage.kv.compareSetMany!([
            { op: 'cas', key: 'save:alpha', expected: { _saveVersion: 4, character: { ryo: 100 } }, value: { _saveVersion: 5, character: { ryo: 0 } } },
            { op: 'cas', key: 'save:beta', expected: { _saveVersion: 8, character: { ryo: 5 } }, value: { _saveVersion: 10, character: { ryo: 105 } } },
        ]);

        assert.equal(ok, false);
        assert.deepEqual(valueOf('save:alpha'), { _saveVersion: 4, character: { ryo: 100 } }, 'the debit that matched is rolled back with the credit that did not');
        assert.deepEqual(valueOf('save:beta'), { _saveVersion: 9, character: { ryo: 5 } });
        assert.equal(commands.some(c => c.text === 'ROLLBACK'), true);
        assert.equal(commands.some(c => c.text === 'COMMIT'), false);
    });

    test('a refusal under a lock does not poison it: the caller can still read and write', async () => {
        seed('save:alpha', { _saveVersion: 4 });
        await locks.withKvLock('save:alpha', async () => {
            const ok = await storage.kv.compareSetMany!([
                { op: 'cas', key: 'save:alpha', expected: { _saveVersion: 3 }, value: { _saveVersion: 5 } },
            ]);
            assert.equal(ok, false);
            assert.deepEqual(await storage.kv.get('save:alpha'), { _saveVersion: 4 }, 'the read after a refusal still works');
            assert.equal(await storage.kv.compareSet('save:alpha', { _saveVersion: 4 }, { _saveVersion: 5 }), true);
        }, critical);
        assert.deepEqual(valueOf('save:alpha'), { _saveVersion: 5 });
    });

    test('null-expected cas replaces an expired row but refuses a live one; null-expected assert means absent', async () => {
        seed('ledger:currency:ghost', { stale: true }, new Date(clock - 1000).toISOString());
        assert.equal(await storage.kv.compareSetMany!([
            { op: 'cas', key: 'ledger:currency:ghost', expected: null, value: { fresh: true } },
            { op: 'assert', key: 'save:nobody', expected: null },
        ]), true);
        assert.deepEqual(valueOf('ledger:currency:ghost'), { fresh: true });

        seed('save:somebody', { here: true });
        assert.equal(await storage.kv.compareSetMany!([
            { op: 'cas', key: 'ledger:currency:other', expected: null, value: { fresh: true } },
            { op: 'assert', key: 'save:somebody', expected: null },
        ]), false, 'a live row fails an absence assert');
        assert.equal(rows.has('ledger:currency:other'), false);

        assert.equal(await storage.kv.compareSetMany!([
            { op: 'cas', key: 'ledger:currency:ghost', expected: null, value: { again: true } },
        ]), false, 'a live row is never overwritten by a null-expected cas');
        assert.deepEqual(valueOf('ledger:currency:ghost'), { fresh: true });
    });

    test('a delete or assert against a moved row refuses the batch', async () => {
        seed('trade:pending:t2', { state: 'open', owner: 'b' });
        seed('save:alpha', { v: 1 });
        assert.equal(await storage.kv.compareSetMany!([
            { op: 'delete', key: 'trade:pending:t2', expected: { state: 'open', owner: 'a' } },
            { op: 'cas', key: 'save:alpha', expected: { v: 1 }, value: { v: 2 } },
        ]), false);
        assert.equal(rows.has('trade:pending:t2'), true);
        assert.deepEqual(valueOf('save:alpha'), { v: 1 });

        assert.equal(await storage.kv.compareSetMany!([
            { op: 'assert', key: 'world:war:w1', expected: { phase: 'open' } },
            { op: 'cas', key: 'save:alpha', expected: { v: 1 }, value: { v: 2 } },
        ]), false, 'an assert on a missing row fails');
        assert.deepEqual(valueOf('save:alpha'), { v: 1 });
    });

    test('statements run in key order whatever order the batch was passed in', async () => {
        seed('save:zeta', { v: 1 }); seed('ledger:currency:zeta', { v: 1 }); seed('economy-tx:z', { v: 1 });
        await storage.kv.compareSetMany!([
            { op: 'cas', key: 'save:zeta', expected: { v: 1 }, value: { v: 2 } },
            { op: 'assert', key: 'economy-tx:z', expected: { v: 1 } },
            { op: 'cas', key: 'ledger:currency:zeta', expected: { v: 1 }, value: { v: 2 } },
        ]);
        const order = commands.filter(c => c.client !== null && /^(UPDATE|SELECT true AS held)/.test(c.text)).map(c => c.params[0]);
        assert.deepEqual(order, ['economy-tx:z', 'ledger:currency:zeta', 'save:zeta'], 'one global order means two batches cannot deadlock');
    });

    test('a lease that expired before the batch fails it before any mutation, with LockOwnershipLostError', async () => {
        seed('save:alpha', { v: 1 });
        await locks.withKvLock('save:alpha', async () => {
            clock += 6000;
            const before = mutations().length;
            await assert.rejects(storage.kv.compareSetMany!([
                { op: 'cas', key: 'save:alpha', expected: { v: 1 }, value: { v: 2 } },
            ]), locks.LockOwnershipLostError);
            assert.equal(mutations().length, before, 'no data statement ran after the failed fence');
        }, critical);
        assert.deepEqual(valueOf('save:alpha'), { v: 1 });
    });

    test('the lease check covers every held lock, once, inside the batch transaction', async () => {
        seed('save:alpha', { v: 1 }); seed('clan:row', { v: 1 });
        await locks.withKvLock('clan:row', () => locks.withKvLock('save:alpha', async () => {
            commands.length = 0;
            assert.equal(await storage.kv.compareSetMany!([
                { op: 'cas', key: 'save:alpha', expected: { v: 1 }, value: { v: 2 } },
                { op: 'cas', key: 'clan:row', expected: { v: 1 }, value: { v: 2 } },
            ]), true);
            const fences = commands.filter(c => c.text.includes('ORDER BY key FOR SHARE'));
            assert.equal(fences.length, 1);
            assert.deepEqual(fences[0].params[0], ['lock:clan:row', 'lock:save:alpha']);
            assert.equal(new Set(commands.map(c => c.client)).size, 1);
        }, critical), critical);
    });

    test('a lost COMMIT response is never replayed and poisons the lock context', async () => {
        seed('save:alpha', { v: 1 });
        await locks.withKvLock('save:alpha', async () => {
            loseCommit = true;
            await assert.rejects(storage.kv.compareSetMany!([
                { op: 'cas', key: 'save:alpha', expected: { v: 1 }, value: { v: 2 } },
            ]), /lost COMMIT response/);
            await assert.rejects(storage.kv.get('save:alpha'), /lost COMMIT response/, 'every later operation in the context refuses');
        }, critical);
        assert.deepEqual(valueOf('save:alpha'), { v: 2 }, 'the ambiguous commit may well be durable — receipts own retries');
        assert.equal(commands.filter(c => c.text === 'COMMIT').length, 1, 'never replayed');
    });

    test('a failed statement rolls the whole batch back and poisons the lock context', async () => {
        seed('save:alpha', { v: 1 }); seed('save:beta', { v: 1 });
        await locks.withKvLock('save:alpha', async () => {
            failStatement = /^UPDATE/;
            await assert.rejects(storage.kv.compareSetMany!([
                { op: 'cas', key: 'save:alpha', expected: { v: 1 }, value: { v: 2 } },
                { op: 'cas', key: 'save:beta', expected: { v: 1 }, value: { v: 2 } },
            ]), /statement failed/);
            await assert.rejects(storage.kv.set('save:beta', { v: 9 }), /statement failed/);
        }, critical);
        assert.deepEqual(valueOf('save:alpha'), { v: 1 });
        assert.deepEqual(valueOf('save:beta'), { v: 1 });
    });

    test('a committed batch is readable at once and a refused one leaves no cached value', async () => {
        seed('game:cacheable', { v: 1 });
        assert.deepEqual(await storage.kv.get('game:cacheable'), { v: 1 });
        assert.equal(await storage.kv.compareSetMany!([
            { op: 'cas', key: 'game:cacheable', expected: { v: 1 }, value: { v: 2 } },
        ]), true);
        assert.deepEqual(await storage.kv.get('game:cacheable'), { v: 2 }, 'write-through after COMMIT');

        assert.equal(await storage.kv.compareSetMany!([
            { op: 'cas', key: 'game:cacheable', expected: { v: 2 }, value: { v: 3 } },
            { op: 'assert', key: 'game:missing', expected: { v: 1 } },
        ]), false);
        assert.deepEqual(await storage.kv.get('game:cacheable'), { v: 2 }, 'the refused value never reached the cache');
    });

    test('a malformed batch throws before any I/O', async () => {
        const before = commands.length;
        await assert.rejects(storage.kv.compareSetMany!([]), /at least one/);
        await assert.rejects(storage.kv.compareSetMany!([
            { op: 'cas', key: 'save:dup', expected: null, value: 1 },
            { op: 'assert', key: 'save:dup', expected: null },
        ]), /appears twice/);
        await assert.rejects(storage.kv.compareSetMany!([
            { op: 'delete', key: 'save:x', expected: null },
        ]), /expected value/);
        assert.equal(commands.length, before);
    });

    test('compareSet keeps its single-statement shape (no transaction outside a lock)', async () => {
        seed('save:single', { v: 1 });
        assert.equal(await storage.kv.compareSet('save:single', { v: 1 }, { v: 2 }), true);
        assert.equal(commands.some(c => c.text === 'BEGIN'), false);
        assert.deepEqual(valueOf('save:single'), { v: 2 });
    });
});

describe('runtime raw-write guard on the Postgres store', () => {
    test('a raw player-save write is reported; the same write through the commit helper is not', async () => {
        const { commitPlayerSaveRecord } = await import('./save/_commit-player-save.js');
        const { _resetSaveWriteGuardForTest } = await import('./_save-write-guard.js');
        _resetSaveWriteGuardForTest();
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...parts: unknown[]) => { warnings.push(parts.map(String).join(' ')); };
        try {
            await storage.kv.set('save:raw-writer', { _saveVersion: 1, character: { ryo: 5 } });
            assert.equal(warnings.filter((line) => line.includes('raw save write (set)')).length, 1);

            warnings.length = 0;
            await storage.kv.set('save:clan-guarded', { members: [] });
            await storage.kv.set('ledger:currency:raw-writer', { v: 1 });
            assert.deepEqual(warnings.filter((line) => line.includes('raw save write')), [], 'only player saves are guarded');

            seed('save:helper-writer', { _saveVersion: 1, character: { createdAt: 1, ryo: 5 } });
            assert.equal(await commitPlayerSaveRecord(storage.kv, {
                playerName: 'helper-writer',
                saveKey: 'save:helper-writer',
                expected: { _saveVersion: 1, character: { createdAt: 1, ryo: 5 } },
                intended: { _saveVersion: 2, character: { createdAt: 1, ryo: 9 } },
            }), true);
            assert.deepEqual(warnings.filter((line) => line.includes('raw save write')), [], 'the sanctioned path is silent');
            assert.deepEqual((valueOf('ledger:currency:helper-writer') as { balances: unknown }).balances, { ryo: 9 });
        } finally {
            console.warn = original;
        }
    });
});

describe('memory compareSetMany', () => {
    test('applies every operation or none', async () => {
        const kv = storage._makeMemoryKv();
        await kv.set('save:a', { v: 1 });
        await kv.set('ledger:currency:a', { v: 1 });
        await kv.set('pointer', { id: 'p' });

        assert.equal(await kv.compareSetMany!([
            { op: 'cas', key: 'save:a', expected: { v: 1 }, value: { v: 2 } },
            { op: 'cas', key: 'ledger:currency:a', expected: { v: 0 }, value: { v: 2 } },
        ]), false);
        assert.deepEqual(await kv.get('save:a'), { v: 1 }, 'a refusal applies nothing');

        assert.equal(await kv.compareSetMany!([
            { op: 'cas', key: 'save:a', expected: { v: 1 }, value: { v: 2 } },
            { op: 'cas', key: 'ledger:currency:a', expected: { v: 1 }, value: { v: 2 } },
            { op: 'cas', key: 'save:b', expected: null, value: { v: 1 } },
            { op: 'delete', key: 'pointer', expected: { id: 'p' } },
            { op: 'assert', key: 'save:none', expected: null },
        ]), true);
        assert.deepEqual(await kv.get('save:a'), { v: 2 });
        assert.deepEqual(await kv.get('ledger:currency:a'), { v: 2 });
        assert.deepEqual(await kv.get('save:b'), { v: 1 });
        assert.equal(await kv.get('pointer'), null);
    });

    test('a fault injected into compareSet applies to the batch the way Postgres would', async () => {
        // Suites inject save-write faults by replacing the store's compareSet.
        // A multi-key commit must honour them: a refusal or a failure before
        // the write rolls everything back; a write that landed before its reply
        // was lost commits the rest, like a lost COMMIT acknowledgement.
        const kv = storage._makeMemoryKv();
        const original = kv.compareSet.bind(kv);
        const batch = (version: number) => [
            { op: 'cas' as const, key: 'ledger:currency:a', expected: { v: version }, value: { v: version + 1 } },
            { op: 'cas' as const, key: 'save:a', expected: { v: version }, value: { v: version + 1 } },
        ];
        await kv.set('save:a', { v: 1 });
        await kv.set('ledger:currency:a', { v: 1 });

        kv.compareSet = async (key, expected, value, options) => (key === 'save:a' ? false : original(key, expected, value, options));
        assert.equal(await kv.compareSetMany!(batch(1)), false);
        assert.deepEqual(await kv.get('ledger:currency:a'), { v: 1 }, 'a refused save puts the earlier ledger write back');

        kv.compareSet = async (key, expected, value, options) => {
            if (key === 'save:a') throw new Error('injected save failure');
            return original(key, expected, value, options);
        };
        await assert.rejects(kv.compareSetMany!(batch(1)), /injected save failure/);
        assert.deepEqual(await kv.get('ledger:currency:a'), { v: 1 }, 'a failure before the write rolls back');
        assert.deepEqual(await kv.get('save:a'), { v: 1 });

        kv.compareSet = async (key, expected, value, options) => {
            const ok = await original(key, expected, value, options);
            if (key === 'ledger:currency:a') throw new Error('reply lost after write');
            return ok;
        };
        await assert.rejects(kv.compareSetMany!(batch(1)), /reply lost after write/);
        assert.deepEqual(await kv.get('ledger:currency:a'), { v: 2 }, 'the landed write stays');
        assert.deepEqual(await kv.get('save:a'), { v: 2 }, 'and the rest of the batch commits with it');
    });

    test('rejects the same malformed batches as Postgres', async () => {
        const kv = storage._makeMemoryKv();
        await assert.rejects(kv.compareSetMany!([
            { op: 'cas', key: 'k', expected: null, value: 1 },
            { op: 'cas', key: 'k', expected: null, value: 2 },
        ]), /appears twice/);
        assert.equal(await kv.get('k'), null);
    });
});
