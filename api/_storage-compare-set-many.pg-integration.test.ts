import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import type { KvCasOp } from './_storage.js';

/*
 * kv.compareSetMany against a REAL Postgres.
 *
 * Every currency-moving save write commits through compareSetMany
 * (api/save/_commit-player-save.ts). Its unit tests
 * (_storage-compare-set-many.test.ts, _storage-lock-fencing.test.ts) drive the
 * pg adapter over a JS shim of pg.Pool. A shim can only agree with itself; it
 * cannot show that jsonb equality ignores key order, that ON CONFLICT ... WHERE
 * replaces an expired row and nothing else, that FOR SHARE really holds a row,
 * that a refused batch really rolls back statements that already ran, or that
 * two overlapping batches cannot deadlock. This file runs the same adapter
 * against Postgres to prove exactly those. It also proves that a read made
 * while a write waits on its row does not wait, which the process read cache
 * must allow for.
 *
 * It is auto-discovered by scripts/run-tests.mjs, so it skips unless
 * PG_INTEGRATION_DATABASE_URL names a THROWAWAY database. CI provides one in
 * the `CI / pg-integration` job (a postgres:16 service container) and sets
 * PG_INTEGRATION_REQUIRED=1, which turns a missing URL into a failure instead
 * of a green run that tested nothing. To run it locally:
 *
 *   npm run test:ci:postgres -- --pg-bin=PATH --integration-only
 *
 * PATH contains Postgres 16 initdb/pg_ctl. The helper creates a fresh isolated
 * cluster and stops/removes it afterward. Omit --integration-only for the full
 * canonical suite with these tests required. For an existing throwaway database:
 *
 *   PG_INTEGRATION_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/scratch \
 *     node --import tsx --test api/_storage-compare-set-many.pg-integration.test.ts
 *
 * The schema is read from supabase-schema.sql at run time — the kv_store table
 * and the kv_set_nx / kv_incr functions, nothing else (no pg_cron, RLS or
 * Supabase roles) — so these tests never drift from the definitions that file
 * records. Every key the tests write starts with `pgit:` (locks: `lock:pgit:`),
 * except the Era receipt test, which must use the real Era keys: receipts
 * `era:receipt:warBattles:pgit-*` and the `era:contrib-sum:warBattles:*`
 * counter rows. The suite refuses to touch a kv_store that holds any other row.
 */

const DATABASE_URL = process.env.PG_INTEGRATION_DATABASE_URL?.trim() ?? '';
if (!DATABASE_URL && process.env.PG_INTEGRATION_REQUIRED === '1') {
    throw new Error('PG_INTEGRATION_REQUIRED=1 but PG_INTEGRATION_DATABASE_URL is not set: the Postgres integration suite would skip every test.');
}
const SKIP = DATABASE_URL ? false : 'set PG_INTEGRATION_DATABASE_URL to a throwaway Postgres database to run these';
if (DATABASE_URL) {
    // Read on first use by _storage.ts, which is imported only in before().
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.PG_SSL = 'disable';
    delete process.env.SHINOBIX_QA_MEMORY_KV;
}

const pgTest = (name: string, fn: () => Promise<void>) => test(name, { skip: SKIP, timeout: 60_000 }, fn);

/** Every row this suite may write. Anything else marks a database that is not a throwaway. */
const SUITE_ROWS = `(key LIKE 'pgit:%' OR key LIKE 'lock:pgit:%'
    OR key LIKE 'era:receipt:warBattles:pgit-%' OR key LIKE 'era:contrib-sum:warBattles:%')`;

let storage: typeof import('./_storage.js');
let locks: typeof import('./_lock.js');
let admin: pg.Client;

function clientConfig(): pg.ClientConfig {
    const url = new URL(DATABASE_URL);
    return {
        host: url.hostname,
        port: url.port ? Number(url.port) : 5432,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
        ssl: false,
        connectionTimeoutMillis: 10_000,
    };
}

async function openClient(): Promise<pg.Client> {
    const client = new pg.Client(clientConfig());
    // A blocked test that is torn down must not crash the process on a late socket error.
    client.on('error', () => undefined);
    await client.connect();
    return client;
}

/** One statement out of supabase-schema.sql, verbatim, from `start` through `end`. */
function schemaStatement(schema: string, start: string, end: string): string {
    const from = schema.indexOf(start);
    const to = from < 0 ? -1 : schema.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error(`supabase-schema.sql no longer contains "${start}" ... "${end.trim()}"; update this suite.`);
    return schema.slice(from, to + end.length);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Swallow a rejection now so a promise awaited later never surfaces as unhandled. */
function settleLater<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => undefined);
    return promise;
}

type StoredRow = { value: unknown; expires_at: Date | null; updated_at: Date; xmin: string };

async function row(key: string): Promise<StoredRow | null> {
    const { rows } = await admin.query<StoredRow>(
        'SELECT value, expires_at, updated_at, xmin::text AS xmin FROM public.kv_store WHERE key = $1', [key],
    );
    return rows[0] ?? null;
}

async function seed(key: string, value: unknown, expiry: 'none' | 'past' | 'future' = 'none'): Promise<void> {
    await seedJson(key, JSON.stringify(value), expiry);
}

/** Seed from raw JSON text, so a test controls the exact bytes Postgres parses. */
async function seedJson(key: string, json: string, expiry: 'none' | 'past' | 'future' = 'none'): Promise<void> {
    // Expiry comes from the DATABASE clock, the one every predicate compares against.
    const expires = { none: 'NULL', past: "now() - interval '1 second'", future: "now() + interval '1 hour'" }[expiry];
    await admin.query(
        `INSERT INTO public.kv_store (key, value, expires_at, updated_at) VALUES ($1, $2::jsonb, ${expires}, now())`,
        [key, json],
    );
}

/**
 * How many row-level writes have ever reached a `pgit:` data row. A sequence
 * advances outside transactions, so this counts statements that executed even
 * when their transaction rolled back — the only way to see, from outside,
 * whether a batch wrote anything before it failed.
 */
async function dataWrites(): Promise<number> {
    const { rows } = await admin.query<{ last_value: string; is_called: boolean }>('SELECT last_value, is_called FROM public.pgit_data_writes');
    return rows[0].is_called ? Number(rows[0].last_value) : 0;
}

/**
 * Wait until `count` client connections to this database are blocked by
 * another session's lock: the batch under test has reached the row it must
 * wait for. Background workers (autovacuum) are not counted.
 */
async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
        const { rows } = await admin.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
             WHERE datname = current_database() AND backend_type = 'client backend'
               AND pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0`,
        );
        if (rows[0].n >= count) return;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} blocked backend(s); saw ${rows[0].n}`);
        await sleep(20);
    }
}

const many = (ops: KvCasOp[]) => storage.kv.compareSetMany!(ops);
const critical = { failClosed: true, maxAttempts: 1, baseBackoffMs: 1 };

describe('kv.compareSetMany on a real Postgres', () => {
    before(async () => {
        if (SKIP) return;
        admin = await openClient();
        const { rows: [server] } = await admin.query<{ server_version: string }>('SHOW server_version');
        console.log(`[pg-integration] PostgreSQL ${server.server_version}`);

        const { rows: [table] } = await admin.query<{ present: boolean }>("SELECT to_regclass('public.kv_store') IS NOT NULL AS present");
        if (table.present) {
            const { rows: [foreign] } = await admin.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM public.kv_store WHERE NOT ${SUITE_ROWS}`,
            );
            if (foreign.n > 0) {
                throw new Error(`PG_INTEGRATION_DATABASE_URL points at a kv_store holding ${foreign.n} real row(s). Refusing to run: use a throwaway database.`);
            }
        }

        const schema = readFileSync('supabase-schema.sql', 'utf8').replace(/\r\n/g, '\n');
        await admin.query(schemaStatement(schema, 'create table if not exists public.kv_store (', '\n);'));
        // The key index image manifests list ids by (the shared-row split).
        await admin.query(schemaStatement(schema, 'create index if not exists kv_store_key_pattern_idx', ';'));
        await admin.query(schemaStatement(schema, 'create or replace function public.kv_set_nx(', '\n$$;'));
        await admin.query(schemaStatement(schema, 'create or replace function public.kv_incr(', '\n$$;'));
        await admin.query(schemaStatement(schema, 'create or replace function public.kv_hset(', '\n$$;'));
        await admin.query(schemaStatement(schema, 'create or replace function public.kv_hdel(', '\n$$;'));

        // Test-only instrumentation for dataWrites(); dropped in after().
        await admin.query('CREATE SEQUENCE IF NOT EXISTS public.pgit_data_writes');
        await admin.query(`CREATE OR REPLACE FUNCTION public.pgit_count_data_write() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.key LIKE 'pgit:%' THEN PERFORM nextval('public.pgit_data_writes'); END IF;
                    RETURN OLD;
                END IF;
                IF NEW.key LIKE 'pgit:%' THEN PERFORM nextval('public.pgit_data_writes'); END IF;
                RETURN NEW;
            END;
            $$`);
        await admin.query('DROP TRIGGER IF EXISTS pgit_count_data_write ON public.kv_store');
        await admin.query(`CREATE TRIGGER pgit_count_data_write BEFORE INSERT OR UPDATE OR DELETE ON public.kv_store
            FOR EACH ROW EXECUTE FUNCTION public.pgit_count_data_write()`);

        storage = await import('./_storage.js');
        locks = await import('./_lock.js');
    });

    beforeEach(async () => {
        if (SKIP) return;
        await admin.query(`DELETE FROM public.kv_store WHERE ${SUITE_ROWS}`);
    });

    after(async () => {
        if (SKIP) return;
        await storage?.closeStoragePool();
        if (!admin) return;
        await admin.query(`DELETE FROM public.kv_store WHERE ${SUITE_ROWS}`).catch(() => undefined);
        await admin.query('DROP TRIGGER IF EXISTS pgit_count_data_write ON public.kv_store').catch(() => undefined);
        await admin.query('DROP FUNCTION IF EXISTS public.pgit_count_data_write()').catch(() => undefined);
        await admin.query('DROP SEQUENCE IF EXISTS public.pgit_data_writes').catch(() => undefined);
        await admin.end();
    });

    pgTest('commits every operation together, in one transaction', async () => {
        await seed('pgit:all:save', { _saveVersion: 4, character: { ryo: 100 } });
        await seed('pgit:all:ledger', { v: 2, balances: { ryo: 100 } });
        await seed('pgit:all:pending', { state: 'open' });
        await seed('pgit:all:receipt', { state: 'reserved' });
        const asserted = await row('pgit:all:receipt');

        assert.equal(await many([
            { op: 'cas', key: 'pgit:all:save', expected: { _saveVersion: 4, character: { ryo: 100 } }, value: { _saveVersion: 5, character: { ryo: 40 } } },
            { op: 'cas', key: 'pgit:all:ledger', expected: { v: 2, balances: { ryo: 100 } }, value: { v: 2, balances: { ryo: 40 } } },
            { op: 'cas', key: 'pgit:all:credit', expected: null, value: { _saveVersion: 1, character: { ryo: 60 } } },
            { op: 'delete', key: 'pgit:all:pending', expected: { state: 'open' } },
            { op: 'assert', key: 'pgit:all:receipt', expected: { state: 'reserved' } },
        ]), true);

        const save = await row('pgit:all:save');
        const ledger = await row('pgit:all:ledger');
        const credit = await row('pgit:all:credit');
        assert.deepEqual(save?.value, { _saveVersion: 5, character: { ryo: 40 } });
        assert.deepEqual(ledger?.value, { v: 2, balances: { ryo: 40 } });
        assert.deepEqual(credit?.value, { _saveVersion: 1, character: { ryo: 60 } });
        assert.equal(credit?.expires_at, null);
        assert.equal(await row('pgit:all:pending'), null);
        // xmin is the id of the transaction that wrote a row version: one value
        // across all three written rows is one transaction, observed directly.
        assert.equal(new Set([save?.xmin, ledger?.xmin, credit?.xmin]).size, 1, 'every write carries the same transaction id');
        const receipt = await row('pgit:all:receipt');
        assert.deepEqual(receipt?.value, { state: 'reserved' });
        assert.equal(receipt?.xmin, asserted?.xmin, 'an assert writes no new row version');
        assert.equal(receipt?.updated_at.getTime(), asserted?.updated_at.getTime());
    });

    pgTest('one moved predecessor rolls back statements that already ran, and returns false', async () => {
        // Keys run in sorted order, so the debit, the insert and the delete all
        // EXECUTE before the moved credit is reached. Only a real ROLLBACK undoes them.
        await seed('pgit:rb:a-debit', { ryo: 100 });
        await seed('pgit:rb:c-pending', { state: 'open' });
        await seed('pgit:rb:z-credit', { ryo: 5 });
        const debitBefore = await row('pgit:rb:a-debit');
        const writesBefore = await dataWrites();

        assert.equal(await many([
            { op: 'cas', key: 'pgit:rb:a-debit', expected: { ryo: 100 }, value: { ryo: 0 } },
            { op: 'cas', key: 'pgit:rb:b-receipt', expected: null, value: { paid: 100 } },
            { op: 'delete', key: 'pgit:rb:c-pending', expected: { state: 'open' } },
            { op: 'cas', key: 'pgit:rb:z-credit', expected: { ryo: 4 }, value: { ryo: 105 } },
        ]), false);

        assert.equal(await dataWrites() - writesBefore, 3, 'the three earlier statements really executed');
        const debit = await row('pgit:rb:a-debit');
        assert.deepEqual(debit?.value, { ryo: 100 });
        assert.equal(debit?.xmin, debitBefore?.xmin, 'the executed debit was rolled back, not rewritten');
        assert.equal(await row('pgit:rb:b-receipt'), null);
        assert.deepEqual((await row('pgit:rb:c-pending'))?.value, { state: 'open' });
        assert.deepEqual((await row('pgit:rb:z-credit'))?.value, { ryo: 5 });

        // The pool connection that rolled back is healthy: the corrected batch commits.
        assert.equal(await many([
            { op: 'cas', key: 'pgit:rb:a-debit', expected: { ryo: 100 }, value: { ryo: 0 } },
            { op: 'cas', key: 'pgit:rb:z-credit', expected: { ryo: 5 }, value: { ryo: 105 } },
        ]), true);
        assert.deepEqual((await row('pgit:rb:z-credit'))?.value, { ryo: 105 });
    });

    pgTest('null-expected cas inserts an absent key and replaces an expired row, but never a live one', async () => {
        assert.equal(await many([{ op: 'cas', key: 'pgit:nx:fresh', expected: null, value: { n: 1 } }]), true);
        assert.deepEqual((await row('pgit:nx:fresh'))?.value, { n: 1 });

        assert.equal(await many([{ op: 'cas', key: 'pgit:nx:ttl', expected: null, value: { n: 1 }, ex: 120 }]), true);
        const { rows: [ttl] } = await admin.query<{ ok: boolean }>(
            "SELECT expires_at BETWEEN now() + interval '60 seconds' AND now() + interval '180 seconds' AS ok FROM public.kv_store WHERE key = 'pgit:nx:ttl'",
        );
        assert.equal(ttl.ok, true, 'ex is written as the new expiry');

        // ON CONFLICT ... DO UPDATE ... WHERE expires_at <= now(): the expired row
        // is replaced in place, value AND expiry.
        await seed('pgit:nx:expired', { stale: true }, 'past');
        assert.equal(await many([{ op: 'cas', key: 'pgit:nx:expired', expected: null, value: { fresh: true } }]), true);
        const replaced = await row('pgit:nx:expired');
        assert.deepEqual(replaced?.value, { fresh: true });
        assert.equal(replaced?.expires_at, null, 'the stale expiry does not survive the replacement');

        // A live row — with or without a TTL — makes the ON CONFLICT WHERE false.
        await seed('pgit:nx:live-ttl', { owner: 'a' }, 'future');
        await seed('pgit:nx:live', { owner: 'a' });
        const liveTtlBefore = await row('pgit:nx:live-ttl');
        for (const key of ['pgit:nx:live-ttl', 'pgit:nx:live']) {
            assert.equal(await many([{ op: 'cas', key, expected: null, value: { owner: 'b' } }]), false, `${key} is live`);
            assert.deepEqual((await row(key))?.value, { owner: 'a' });
        }
        const liveTtl = await row('pgit:nx:live-ttl');
        assert.equal(liveTtl?.expires_at?.getTime(), liveTtlBefore?.expires_at?.getTime(), 'a refused insert leaves the TTL alone');
        assert.equal(liveTtl?.xmin, liveTtlBefore?.xmin);

        // An expired row is absent to a value-expected cas too, even when the value matches.
        await seed('pgit:nx:expired-match', { v: 1 }, 'past');
        assert.equal(await many([{ op: 'cas', key: 'pgit:nx:expired-match', expected: { v: 1 }, value: { v: 2 } }]), false);
        assert.deepEqual((await row('pgit:nx:expired-match'))?.value, { v: 1 });
    });

    pgTest('jsonb matching ignores object key order and spelling, and nothing else', async () => {
        // Postgres stores jsonb keys in its own canonical order (shorter keys
        // first); `reordered` serialises them in a different one. The stored text
        // also spells é and 🥷 as \u escapes and 1 as 1.0, where JSON.stringify
        // sends them raw and as 1: equal values, different bytes.
        const stored = '{"zeta": {"y": [1, {"q": "it\'s \\"quoted\\" \\\\ \\u00e9 \\ud83e\\udd77", "p": 2}], "x": null}, "a": 1.0, "mid": true}';
        const text = 'it\'s "quoted" \\ é 🥷';
        const reordered = { mid: true, a: 1, zeta: { x: null, y: [1, { p: 2, q: text }] } };
        await seedJson('pgit:json:cas', stored);
        await seedJson('pgit:json:delete', stored);
        await seedJson('pgit:json:assert', stored);

        assert.equal(await many([
            { op: 'assert', key: 'pgit:json:assert', expected: reordered },
            { op: 'cas', key: 'pgit:json:cas', expected: reordered, value: { done: true } },
            { op: 'delete', key: 'pgit:json:delete', expected: reordered },
        ]), true);
        assert.deepEqual((await row('pgit:json:cas'))?.value, { done: true });
        assert.equal(await row('pgit:json:delete'), null);

        const mismatches: Array<[string, unknown]> = [
            ['array order matters', { ...reordered, zeta: { x: null, y: [{ p: 2, q: text }, 1] } }],
            ['a string is not a number', { ...reordered, a: '1' }],
            ['an extra key is a different object', { ...reordered, extra: null }],
        ];
        for (const [why, expected] of mismatches) {
            assert.equal(await many([{ op: 'assert', key: 'pgit:json:assert', expected }]), false, why);
        }
    });

    pgTest('delete removes only a live row equal to expected', async () => {
        await seed('pgit:del:match', { lease: 'mine' });
        await seed('pgit:del:other', { lease: 'theirs' });
        await seed('pgit:del:expired', { lease: 'mine' }, 'past');

        assert.equal(await many([{ op: 'delete', key: 'pgit:del:match', expected: { lease: 'mine' } }]), true);
        assert.equal(await row('pgit:del:match'), null);

        assert.equal(await many([
            { op: 'delete', key: 'pgit:del:other', expected: { lease: 'mine' } },
            { op: 'cas', key: 'pgit:del:side-effect', expected: null, value: { n: 1 } },
        ]), false, 'a moved row refuses the batch');
        assert.deepEqual((await row('pgit:del:other'))?.value, { lease: 'theirs' });
        assert.equal(await row('pgit:del:side-effect'), null);

        assert.equal(await many([{ op: 'delete', key: 'pgit:del:expired', expected: { lease: 'mine' } }]), false, 'an expired row is not live');
        assert.equal(await many([{ op: 'delete', key: 'pgit:del:never', expected: { lease: 'mine' } }]), false, 'an absent row is not live');
    });

    pgTest('assert: null means absent (or expired); a value means that exact live row', async () => {
        await seed('pgit:as:present', { phase: 'open' });
        await seed('pgit:as:expired', { phase: 'open' }, 'past');

        assert.equal(await many([
            { op: 'assert', key: 'pgit:as:absent', expected: null },
            { op: 'assert', key: 'pgit:as:expired', expected: null },
            { op: 'assert', key: 'pgit:as:present', expected: { phase: 'open' } },
            { op: 'cas', key: 'pgit:as:write', expected: null, value: { n: 1 } },
        ]), true);
        assert.deepEqual((await row('pgit:as:write'))?.value, { n: 1 });

        const refusals: Array<[string, KvCasOp]> = [
            ['a live row fails an absence assert', { op: 'assert', key: 'pgit:as:present', expected: null }],
            ['an absent row fails a value assert', { op: 'assert', key: 'pgit:as:absent', expected: { phase: 'open' } }],
            ['an expired row fails a value assert', { op: 'assert', key: 'pgit:as:expired', expected: { phase: 'open' } }],
            ['a different value fails a value assert', { op: 'assert', key: 'pgit:as:present', expected: { phase: 'closed' } }],
        ];
        for (const [why, op] of refusals) {
            assert.equal(await many([op, { op: 'cas', key: 'pgit:as:write', expected: { n: 1 }, value: { n: 2 } }]), false, why);
            assert.deepEqual((await row('pgit:as:write'))?.value, { n: 1 }, `${why}: nothing is written`);
        }
    });

    pgTest('an asserted row is held FOR SHARE until COMMIT: a concurrent writer waits for the batch', async () => {
        await seed('pgit:share:a-held', { v: 1 });
        await seed('pgit:share:b-write', { v: 1 });
        const holder = await openClient();
        const rival = await openClient();
        try {
            // Park the batch on its LAST statement, after it has taken the FOR SHARE lock.
            await holder.query('BEGIN');
            await holder.query("SELECT 1 FROM public.kv_store WHERE key = 'pgit:share:b-write' FOR UPDATE");
            const batch = settleLater(many([
                { op: 'assert', key: 'pgit:share:a-held', expected: { v: 1 } },
                { op: 'cas', key: 'pgit:share:b-write', expected: { v: 1 }, value: { v: 2 } },
            ]));
            await waitForLockWaiters(1);

            const rivalWrite = settleLater(rival.query(`UPDATE public.kv_store SET value = '{"v": 99}'::jsonb WHERE key = 'pgit:share:a-held'`));
            await waitForLockWaiters(2);
            assert.deepEqual((await row('pgit:share:a-held'))?.value, { v: 1 }, 'the rival is blocked by the assert, not merely slow');

            await holder.query('ROLLBACK');
            assert.equal(await batch, true);
            assert.equal((await rivalWrite).rowCount, 1, 'the rival proceeds once the batch commits');
            assert.deepEqual((await row('pgit:share:a-held'))?.value, { v: 99 });
            assert.deepEqual((await row('pgit:share:b-write'))?.value, { v: 2 });
        } finally {
            await holder.query('ROLLBACK').catch(() => undefined);
            await holder.end();
            await rival.end();
        }
    });

    pgTest('an assert blocked by a concurrent writer judges the row that writer committed', async () => {
        await seed('pgit:recheck:a', { v: 1 });
        const holder = await openClient();
        try {
            // The writer commits: the batch's snapshot saw {v:1}, but it must re-check
            // the committed {v:2} and refuse.
            await holder.query('BEGIN');
            await holder.query(`UPDATE public.kv_store SET value = '{"v": 2}'::jsonb WHERE key = 'pgit:recheck:a'`);
            const refused = settleLater(many([
                { op: 'assert', key: 'pgit:recheck:a', expected: { v: 1 } },
                { op: 'cas', key: 'pgit:recheck:z-new', expected: null, value: { created: true } },
            ]));
            await waitForLockWaiters(1);
            await holder.query('COMMIT');
            assert.equal(await refused, false);
            assert.equal(await row('pgit:recheck:z-new'), null);

            // The writer rolls back: the row the batch asserted is still there.
            await holder.query('BEGIN');
            await holder.query(`UPDATE public.kv_store SET value = '{"v": 3}'::jsonb WHERE key = 'pgit:recheck:a'`);
            const accepted = settleLater(many([
                { op: 'assert', key: 'pgit:recheck:a', expected: { v: 2 } },
                { op: 'cas', key: 'pgit:recheck:z-new', expected: null, value: { created: true } },
            ]));
            await waitForLockWaiters(1);
            await holder.query('ROLLBACK');
            assert.equal(await accepted, true);
            assert.deepEqual((await row('pgit:recheck:z-new'))?.value, { created: true });
        } finally {
            await holder.query('ROLLBACK').catch(() => undefined);
            await holder.end();
        }
    });

    pgTest('control: the next test\'s two batches, run in the order passed, really do deadlock', async () => {
        // Raw transactions replay the statements compareSetMany would issue for
        // the next test's two batches (same keys, same expected values) if it ran
        // each batch in the order passed instead of key order. Postgres must
        // abort one of them, which shows the next test's schedule is a genuine
        // deadlock, so its passing is the key sort's doing.
        await seed('pgit:order:a', { n: 0 });
        await seed('pgit:order:b', { n: 0 });
        await seed('pgit:order:gate-1', { open: true });
        await seed('pgit:order:gate-2', { open: true });
        const [holder, one, two] = await Promise.all([openClient(), openClient(), openClient()]);
        const step = (client: pg.Client, key: string, from: unknown, to: unknown) => client.query(
            'UPDATE public.kv_store SET value = $3::jsonb WHERE key = $1 AND value = $2::jsonb', [key, JSON.stringify(from), JSON.stringify(to)],
        );
        const gate = (client: pg.Client, key: string) => client.query('SELECT true AS held FROM public.kv_store WHERE key = $1 FOR SHARE', [key]);
        try {
            await holder.query('BEGIN');
            await holder.query("SELECT 1 FROM public.kv_store WHERE key IN ('pgit:order:gate-1', 'pgit:order:gate-2') FOR UPDATE");
            await one.query('BEGIN');
            await two.query('BEGIN');
            const first = settleLater((async () => {
                await step(one, 'pgit:order:a', { n: 0 }, { n: 1 });
                await gate(one, 'pgit:order:gate-1');
                await step(one, 'pgit:order:b', { n: 0 }, { n: 1 });
            })());
            await waitForLockWaiters(1);
            const second = settleLater((async () => {
                await step(two, 'pgit:order:b', { n: 0 }, { n: 2 });
                await gate(two, 'pgit:order:gate-2');
                await step(two, 'pgit:order:a', { n: 0 }, { n: 2 });
            })());
            await waitForLockWaiters(2);
            await holder.query('ROLLBACK');

            const outcomes = await Promise.allSettled([first, second]);
            const victims = outcomes.filter(outcome => outcome.status === 'rejected' && (outcome.reason as { code?: string }).code === '40P01');
            assert.equal(victims.length, 1, `Postgres aborts exactly one transaction as the deadlock victim: ${JSON.stringify(outcomes.map(o => o.status))}`);
        } finally {
            for (const client of [holder, one, two]) {
                await client.query('ROLLBACK').catch(() => undefined);
                await client.end();
            }
        }
    });

    pgTest('two batches on overlapping keys, passed in opposite orders, serialize instead of deadlocking', async () => {
        // Each batch is parked on a gate row after touching its first key. Run in
        // the order passed, the first would hold `a` and the second `b`, each then
        // wanting the other's: Postgres aborts one with "deadlock detected" (the
        // control above). compareSetMany runs every batch in key order, so both
        // take `a` first and the second simply waits for the first.
        //
        // Both batches expect the COMMITTED {n:0}, exactly as the control does.
        // Postgres judges an UPDATE's WHERE against the committed row before it
        // waits for a row lock, so a batch expecting the first one's uncommitted
        // {n:1} would not wait at all: it would refuse at once.
        await seed('pgit:order:a', { n: 0 });
        await seed('pgit:order:b', { n: 0 });
        await seed('pgit:order:gate-1', { open: true });
        await seed('pgit:order:gate-2', { open: true });
        const holder = await openClient();
        try {
            await holder.query('BEGIN');
            await holder.query("SELECT 1 FROM public.kv_store WHERE key IN ('pgit:order:gate-1', 'pgit:order:gate-2') FOR UPDATE");
            const first = settleLater(many([
                { op: 'cas', key: 'pgit:order:a', expected: { n: 0 }, value: { n: 1 } },
                { op: 'assert', key: 'pgit:order:gate-1', expected: { open: true } },
                { op: 'cas', key: 'pgit:order:b', expected: { n: 0 }, value: { n: 1 } },
            ]));
            await waitForLockWaiters(1);
            const second = settleLater(many([
                { op: 'cas', key: 'pgit:order:b', expected: { n: 0 }, value: { n: 2 } },
                { op: 'assert', key: 'pgit:order:gate-2', expected: { open: true } },
                { op: 'cas', key: 'pgit:order:a', expected: { n: 0 }, value: { n: 2 } },
            ]));
            await waitForLockWaiters(2);
            await holder.query('ROLLBACK');

            // No 40P01: the second batch waited behind the first, re-checked `a`
            // once the first committed, and refused cleanly because it had moved.
            assert.deepEqual(await Promise.all([first, second]), [true, false], 'neither batch was aborted as a deadlock victim');
            assert.deepEqual((await row('pgit:order:a'))?.value, { n: 1 }, 'the second batch judged the first one\'s committed row and wrote nothing');
            assert.deepEqual((await row('pgit:order:b'))?.value, { n: 1 });
        } finally {
            await holder.query('ROLLBACK').catch(() => undefined);
            await holder.end();
        }
    });

    pgTest('racing opposite-order batches never throw, and exactly one wins each round', async () => {
        await seed('pgit:race:a', { n: 0 });
        await seed('pgit:race:b', { n: 0 });
        const rounds = 25;
        for (let n = 0; n < rounds; n++) {
            const results = await Promise.allSettled([
                many([
                    { op: 'cas', key: 'pgit:race:a', expected: { n }, value: { n: n + 1 } },
                    { op: 'cas', key: 'pgit:race:b', expected: { n }, value: { n: n + 1 } },
                ]),
                many([
                    { op: 'cas', key: 'pgit:race:b', expected: { n }, value: { n: n + 1 } },
                    { op: 'cas', key: 'pgit:race:a', expected: { n }, value: { n: n + 1 } },
                ]),
            ]);
            const failures = results.filter(result => result.status === 'rejected');
            assert.deepEqual(failures, [], `round ${n}: no batch may fail`);
            const wins = results.filter(result => result.status === 'fulfilled' && result.value === true).length;
            assert.equal(wins, 1, `round ${n}: exactly one batch commits`);
        }
        assert.deepEqual((await row('pgit:race:a'))?.value, { n: rounds });
        assert.deepEqual((await row('pgit:race:b'))?.value, { n: rounds });
    });

    pgTest('paid pet admission commits the save and combat together, retaining guards and duplicate-key refusal', async () => {
        const { showdownAdmissionStore } = await import('./pet/_showdown-admission.js');
        const { writeVersionedPlayerSaveWithStore } = await import('./save/_mutate-player-save.js');
        const { inPlayerSaveCommit } = await import('./_save-write-guard.js');
        const saveKey = 'pgit:pet-admission:a-save';
        const sessionKey = 'pgit:pet-admission:z-session';
        const saved = { _saveVersion: 4, character: { name: 'admissionfixture', ryo: 100,
            pets: [{ id: 'lead', loadout: { consumable: 'consum-smoke-pellet' } }] } };
        const next = { ...saved.character, pets: [{ id: 'lead', loadout: {} }],
            petShowdownAdmission: { sessionId: 'sealedfixture01', at: 1 } };
        const combat = { sessionId: 'sealedfixture01', consumablesCommitted: true };
        await seed(saveKey, saved);
        await seed(sessionKey, { sessionId: 'occupied' });
        let guardedCalls = 0;
        const underlying = {
            get: storage.kv.get.bind(storage.kv),
            compareSetMany: async (ops: readonly KvCasOp[]) => {
                assert.equal(inPlayerSaveCommit(), true, 'the canonical commit authority survives the wrapper');
                guardedCalls += 1;
                return storage.kv.compareSetMany!(ops);
            },
        };
        const store = showdownAdmissionStore(underlying, { op: 'cas', key: sessionKey, expected: null, value: combat, ex: 2700 });
        await locks.withKvLock(saveKey, async () => {
            // The save sorts first and is written before the occupied artifact
            // refuses its insert. Postgres must roll that debit back too.
            const writes = await dataWrites();
            await assert.rejects(writeVersionedPlayerSaveWithStore(store, saveKey, saved, next), /player-save-version-conflict/);
            assert.ok(await dataWrites() > writes, 'the refused transaction actually attempted data writes');
            assert.deepEqual((await row(saveKey))?.value, saved);
            assert.deepEqual((await row(sessionKey))?.value, { sessionId: 'occupied' });
            await admin.query('DELETE FROM public.kv_store WHERE key = $1', [sessionKey]);
            const written = await writeVersionedPlayerSaveWithStore(store, saveKey, saved, next);
            assert.equal(written._saveVersion, 5);
            const save = await row(saveKey), session = await row(sessionKey);
            assert.equal(save?.xmin, session?.xmin, 'item debit, pointer and combat share one real transaction');
            assert.deepEqual((save?.value as { character: unknown }).character, next);
            assert.deepEqual(session?.value, combat);
            assert.ok(session?.expires_at && session.expires_at.getTime() - Date.now() > 2690_000);
            assert.ok(session.expires_at.getTime() - Date.now() <= 2700_000);
            const duplicate = showdownAdmissionStore(underlying, { op: 'cas', key: saveKey, expected: null, value: combat });
            await assert.rejects(writeVersionedPlayerSaveWithStore(duplicate, saveKey, written.record, next), /appears twice/);
            assert.equal((await row(saveKey))?.xmin, save?.xmin, 'duplicate keys cannot partially advance the save');
        }, critical);
        assert.equal(guardedCalls, 3);

        // The wrapper also preserves the storage lease fence. A stolen lease
        // must refuse both the save and the unpublished combat.
        const fencedKey = 'pgit:pet-admission:fenced-session';
        const current = (await row(saveKey))!.value as Record<string, unknown>;
        const fenced = showdownAdmissionStore(underlying, { op: 'cas', key: fencedKey, expected: null, value: combat });
        await locks.withKvLock(saveKey, async () => {
            await admin.query("UPDATE public.kv_store SET value = to_jsonb('another-worker'::text) WHERE key = $1", [`lock:${saveKey}`]);
            const before = await row(saveKey);
            await assert.rejects(writeVersionedPlayerSaveWithStore(fenced, saveKey, current, next), locks.LockOwnershipLostError);
            assert.equal((await row(saveKey))?.xmin, before?.xmin);
            assert.equal(await row(fencedKey), null);
        }, critical);
    });

    pgTest('under a live lock the lease check passes and the batch commits', async () => {
        await seed('pgit:lock:save', { v: 1 });
        await seed('pgit:lock:clan', { v: 1 });
        const before = await dataWrites();
        await locks.withKvLock('pgit:lock:clan', () => locks.withKvLock('pgit:lock:save', async () => {
            assert.equal(await many([
                { op: 'cas', key: 'pgit:lock:save', expected: { v: 1 }, value: { v: 2 } },
                { op: 'cas', key: 'pgit:lock:clan', expected: { v: 1 }, value: { v: 2 } },
            ]), true);
        }, critical), critical);
        assert.equal(await dataWrites() - before, 2);
        assert.deepEqual((await row('pgit:lock:save'))?.value, { v: 2 });
        assert.deepEqual((await row('pgit:lock:clan'))?.value, { v: 2 });
        assert.equal(await row('lock:pgit:lock:save'), null, 'both leases are released');
        assert.equal(await row('lock:pgit:lock:clan'), null);
    });

    pgTest('an expired lease fails the batch with LockOwnershipLostError before any write', async () => {
        await seed('pgit:lease:target', { v: 1 });
        const targetBefore = await row('pgit:lease:target');
        await locks.withKvLock('pgit:lease:target', async () => {
            // The lease's expiry was set from the Node clock; the fence compares it
            // with the database clock. Wait on the database's own verdict.
            const deadline = Date.now() + 15_000;
            for (;;) {
                const { rows: [lease] } = await admin.query<{ expired: boolean }>(
                    "SELECT expires_at <= clock_timestamp() AS expired FROM public.kv_store WHERE key = 'lock:pgit:lease:target'",
                );
                if (lease?.expired) break;
                assert.ok(Date.now() < deadline, 'the one-second lease never expired');
                await sleep(100);
            }
            const before = await dataWrites();
            await assert.rejects(many([
                { op: 'cas', key: 'pgit:lease:target', expected: { v: 1 }, value: { v: 2 } },
                { op: 'cas', key: 'pgit:lease:new', expected: null, value: { v: 1 } },
            ]), locks.LockOwnershipLostError);
            assert.equal(await dataWrites(), before, 'not one data statement executed');
            await assert.rejects(storage.kv.get('pgit:lease:target'), locks.LockOwnershipLostError, 'the context stays poisoned');
        }, { ...critical, ttlSec: 1 });
        const target = await row('pgit:lease:target');
        assert.deepEqual(target?.value, { v: 1 });
        assert.equal(target?.xmin, targetBefore?.xmin);
        assert.equal(await row('pgit:lease:new'), null);
    });

    pgTest('a lease taken over by another owner fails the batch before any write', async () => {
        await seed('pgit:takeover:target', { v: 1 });
        await locks.withKvLock('pgit:takeover:target', async () => {
            // Another worker's lease, live and stored the way kv_set_nx stores one: a jsonb string.
            const { rowCount } = await admin.query(
                "UPDATE public.kv_store SET value = to_jsonb('another-worker'::text), expires_at = now() + interval '1 minute' WHERE key = 'lock:pgit:takeover:target'",
            );
            assert.equal(rowCount, 1);
            const before = await dataWrites();
            await assert.rejects(many([
                { op: 'cas', key: 'pgit:takeover:target', expected: { v: 1 }, value: { v: 2 } },
            ]), locks.LockOwnershipLostError);
            assert.equal(await dataWrites(), before);
        }, critical);
        assert.deepEqual((await row('pgit:takeover:target'))?.value, { v: 1 });
        assert.deepEqual((await row('lock:pgit:takeover:target'))?.value, 'another-worker', 'release never deletes a lease it no longer owns');
    });

    // A single locked statement sends BEGIN and its lease check as ONE
    // simple-protocol message with the lease keys inlined as escaped literals.
    // These prove, on a real server, that the transaction that message opens
    // stays open for the statement, and that the escaping holds.
    pgTest('a single locked statement commits under a live lease, even for a lock target with a quote and a backslash', async () => {
        const target = String.raw`pgit:it's a \odd' target`;
        await locks.withKvLock(target, async () => {
            await storage.kv.set('pgit:single:quoted', { v: 1 });
            assert.deepEqual(await storage.kv.get('pgit:single:quoted'), { v: 1 });
        }, critical);
        assert.deepEqual((await row('pgit:single:quoted'))?.value, { v: 1 });
        assert.equal(await row(`lock:${target}`), null, 'the lease was found by its exact key and released');
    });

    pgTest('a single locked statement holds the owner row FOR SHARE until COMMIT', async () => {
        // Hold the data row with a row lock so the locked write parks AFTER its
        // combined BEGIN + lease-check message has run.
        await seed('pgit:single:held', { v: 1 });
        const holder = await openClient();
        try {
            await holder.query('BEGIN');
            await holder.query("SELECT 1 FROM public.kv_store WHERE key = 'pgit:single:held' FOR UPDATE");
            const write = settleLater(locks.withKvLock('pgit:single:held', () => storage.kv.set('pgit:single:held', { v: 2 }), critical));
            await waitForLockWaiters(1);
            // The owner row is share-locked by the parked transaction: a takeover
            // write on it cannot proceed until that transaction ends.
            const { rows: [lock] } = await admin.query<{ locked: boolean }>(
                `SELECT NOT EXISTS (SELECT 1 FROM public.kv_store WHERE key = 'lock:pgit:single:held' FOR UPDATE SKIP LOCKED) AS locked`,
            );
            assert.equal(lock.locked, true, 'the lease row is held by the open fenced transaction');
            await holder.query('COMMIT');
            await write;
        } finally {
            await holder.end();
        }
        assert.deepEqual((await row('pgit:single:held'))?.value, { v: 2 });
    });

    pgTest('an expired lease stops a single locked statement before it writes', async () => {
        await seed('pgit:single:expired', { v: 1 });
        await locks.withKvLock('pgit:single:expired', async () => {
            const deadline = Date.now() + 15_000;
            for (;;) {
                const { rows: [lease] } = await admin.query<{ expired: boolean }>(
                    "SELECT expires_at <= clock_timestamp() AS expired FROM public.kv_store WHERE key = 'lock:pgit:single:expired'",
                );
                if (lease?.expired) break;
                assert.ok(Date.now() < deadline, 'the one-second lease never expired');
                await sleep(100);
            }
            const before = await dataWrites();
            await assert.rejects(storage.kv.set('pgit:single:expired', { v: 2 }), locks.LockOwnershipLostError);
            assert.equal(await dataWrites(), before, 'not one data statement executed');
        }, { ...critical, ttlSec: 1 });
        assert.deepEqual((await row('pgit:single:expired'))?.value, { v: 1 });
    });

    pgTest('a quoted lock target taken over by another owner stops a single locked statement', async () => {
        const target = String.raw`pgit:o'clock \takeover`;
        await seed('pgit:single:takeover', { v: 1 });
        await locks.withKvLock(target, async () => {
            const { rowCount } = await admin.query(
                "UPDATE public.kv_store SET value = to_jsonb('another-worker'::text), expires_at = now() + interval '1 minute' WHERE key = $1",
                [`lock:${target}`],
            );
            assert.equal(rowCount, 1);
            const before = await dataWrites();
            await assert.rejects(storage.kv.set('pgit:single:takeover', { v: 2 }), locks.LockOwnershipLostError);
            assert.equal(await dataWrites(), before);
        }, critical);
        assert.deepEqual((await row('pgit:single:takeover'))?.value, { v: 1 });
    });

    // kv_hset / kv_hdel (2026-10-12): a hash write that changes nothing writes
    // nothing, and hdel is one UPDATE that cannot undo a concurrent hset. The
    // pg.Pool shim cannot evaluate these functions, so they are proven here.
    pgTest('hset writes new or changed fields, and skips a merge that changes nothing', async () => {
        await storage.kv.hset('pgit:hash:a', { b: 2, a: { x: 1, y: 2 } });
        assert.deepEqual((await row('pgit:hash:a'))?.value, { a: { x: 1, y: 2 }, b: 2 });

        // Judged by the row version, not dataWrites(): kv_hset is an
        // INSERT ... ON CONFLICT, and Postgres fires the BEFORE INSERT trigger
        // for the proposed row before it finds the conflict, so the counter
        // ticks even when the guarded DO UPDATE writes nothing.
        const original = await row('pgit:hash:a');
        // Same values, different key order at both levels: jsonb equality is structural.
        await storage.kv.hset('pgit:hash:a', { a: { y: 2, x: 1 } });
        await storage.kv.hset('pgit:hash:a', { b: 2 });
        const unchanged = await row('pgit:hash:a');
        assert.equal(unchanged?.xmin, original?.xmin, 'an unchanged merge never rewrites the row');
        assert.equal(unchanged?.updated_at.getTime(), original?.updated_at.getTime(), 'updated_at keeps the last real change');

        await storage.kv.hset('pgit:hash:a', { b: 3, c: 'new' });
        const changed = await row('pgit:hash:a');
        assert.notEqual(changed?.xmin, original?.xmin, 'a real change still writes');
        assert.deepEqual(changed?.value, { a: { x: 1, y: 2 }, b: 3, c: 'new' });
    });

    pgTest('hdel removes present fields, and leaves the row untouched when none is present', async () => {
        await seed('pgit:hash:d', { keep: 1, gone: 2, also: 3 });
        const before = await dataWrites();
        await storage.kv.hdel('pgit:hash:d', 'missing', 'nothere');
        await storage.kv.hdel('pgit:hash:absent-row', 'x');
        assert.equal(await dataWrites(), before, 'deleting absent fields writes nothing');

        await storage.kv.hdel('pgit:hash:d', 'gone', 'missing', 'also');
        assert.equal(await dataWrites(), before + 1);
        assert.deepEqual((await row('pgit:hash:d'))?.value, { keep: 1 });
        assert.equal(await row('pgit:hash:absent-row'), null, 'hdel never creates a row');
    });

    pgTest('an hdel racing an hset can no longer undo the hset', async () => {
        // The old kv_hdel read the row, then wrote back its own copy: an hset
        // committing in between was silently erased.
        await seed('pgit:hash:race', { stale: 1, keep: 1 });
        const holder = await openClient();
        try {
            await holder.query('BEGIN');
            await holder.query(
                "UPDATE public.kv_store SET value = value || '{\"fresh\": 1}'::jsonb WHERE key = 'pgit:hash:race'",
            );
            const del = settleLater(storage.kv.hdel('pgit:hash:race', 'stale'));
            await waitForLockWaiters(1);
            await holder.query('COMMIT');
            await del;
        } finally {
            await holder.end();
        }
        assert.deepEqual((await row('pgit:hash:race'))?.value, { keep: 1, fresh: 1 },
            'the concurrent write survives and only the named field is removed');
    });

    // The process read cache (api/_storage.ts, "Fill generations"). While a
    // write waits on its row, a plain read on another connection does not wait:
    // it returns the predecessor, and the old code cached that row for the TTL
    // after the write landed. The pg.Pool shim can only assume the read does not
    // block; here Postgres decides.
    async function readWhileWriteWaits(key: string, write: () => Promise<unknown>): Promise<unknown> {
        const holder = await openClient();
        try {
            await holder.query('BEGIN');
            await holder.query('SELECT 1 FROM public.kv_store WHERE key = $1 FOR UPDATE', [key]);
            const pending = settleLater(write());
            await waitForLockWaiters(1);
            const seen = await storage.kv.get(key);
            await holder.query('COMMIT');
            await pending;
            return seen;
        } finally {
            await holder.end();
        }
    }

    pgTest('a read made while hset waits on its row is not served once the hset lands', async () => {
        await seed('pgit:cache:hset', { a: 'old', b: 'kept' });
        assert.deepEqual(await readWhileWriteWaits('pgit:cache:hset', () => storage.kv.hset('pgit:cache:hset', { a: 'new' })),
            { a: 'old', b: 'kept' }, 'the read did not wait for the row lock: it saw the predecessor');
        assert.deepEqual(await storage.kv.get('pgit:cache:hset'), { a: 'new', b: 'kept' });
    });

    pgTest('a read made while incr waits on its row is not served once the incr lands', async () => {
        // The image version counter: a stale cached version would keep handing
        // out the URLs the bump just retired.
        await seed('pgit:cache:incr', 4);
        assert.equal(await readWhileWriteWaits('pgit:cache:incr', () => storage.kv.incr('pgit:cache:incr')), 4);
        assert.equal(await storage.kv.get('pgit:cache:incr'), 5);
    });

    // kv.mgetProjected detoasts each row once and reads every path from that
    // copy (the roster's 7-path read went 1,145 ms → 183 ms in production). The
    // pg.Pool shim cannot evaluate SQL, so the identical-result claim is proven
    // here: objects, missing paths, non-object rows, expiry, absent keys, input
    // order, and a value large enough to be stored out of line (TOAST).
    pgTest('mgetProjected returns the same projection for every row shape', async () => {
        const bulky = 'x'.repeat(300_000); // well past the ~2 kB TOAST threshold
        await seed('pgit:proj:full', { character: { name: 'A', lvl: 3 }, currentSector: 7, blob: bulky, deep: { a: { b: 5 } } });
        await seed('pgit:proj:partial', { character: { name: 'B' } });
        await seed('pgit:proj:array', [1, 2, 3]);
        await seedJson('pgit:proj:string', '"just text"');
        await seedJson('pgit:proj:null', 'null');
        await seed('pgit:proj:expired', { character: { name: 'C' } }, 'past');
        await seed('pgit:proj:live-ttl', { currentSector: 2 }, 'future');
        const { rows: [stored] } = await admin.query<{ external: boolean }>(
            "SELECT pg_column_size(value) < octet_length(value::text) AS external FROM public.kv_store WHERE key = 'pgit:proj:full'",
        );
        assert.equal(stored.external, true, 'the bulky row must actually be compressed/out of line for this test to mean anything');

        const keys = ['pgit:proj:live-ttl', 'pgit:proj:full', 'pgit:proj:missing', 'pgit:proj:partial', 'pgit:proj:array', 'pgit:proj:string', 'pgit:proj:null', 'pgit:proj:expired'];
        const got = await storage.kv.mgetProjected!(keys, {
            character: ['character'], currentSector: ['currentSector'], depth: ['deep', 'a', 'b'],
        });
        assert.deepEqual(got, [
            { currentSector: 2 },
            { character: { name: 'A', lvl: 3 }, currentSector: 7, depth: 5 },
            null,
            { character: { name: 'B' } },
            null,
            null,
            null,
            null,
        ]);
        assert.deepEqual(await storage.kv.mgetProjected!(['pgit:proj:full'], {}), [{}], 'an empty projection of an object is {}');
    });

    // hkeys(nonEmptyStrings) lists image-manifest ids. It used jsonb_each, which
    // spilled every multi-MB value to temp files (73 GB in production); it now
    // lists keys only and tests values in memory. This proves the rows are the
    // same; the spill reduction was measured on production (see _storage.ts).
    pgTest('hkeys nonEmptyStrings keeps exactly the non-empty string fields', async () => {
        const art = 'data:image/png;base64,' + 'A'.repeat(400_000);
        await seed('pgit:hk:images', {
            good: art, tiny: 'x', empty: '', number: 7, nested: { a: 'b' }, list: ['c'], nil: null, flag: true,
        });
        await seed('pgit:hk:array', ['a', 'b']);
        await seed('pgit:hk:expired', { gone: 'yes' }, 'past');
        assert.deepEqual((await storage.kv.hkeys('pgit:hk:images', { nonEmptyStrings: true })).sort(), ['good', 'tiny']);
        assert.deepEqual((await storage.kv.hkeys('pgit:hk:images')).sort(), ['empty', 'flag', 'good', 'list', 'nested', 'nil', 'number', 'tiny']);
        assert.deepEqual(await storage.kv.hkeys('pgit:hk:array', { nonEmptyStrings: true }), []);
        assert.deepEqual(await storage.kv.hkeys('pgit:hk:expired', { nonEmptyStrings: true }), []);
        assert.deepEqual(await storage.kv.hkeys('pgit:hk:missing', { nonEmptyStrings: true }), []);
    });

    // Since the shared-row split (docs/SHARED_HASH_ROW_SPLIT_PLAN.md), image
    // manifests list ids by key prefix: kv.keys('shared:img:<prefix>:*'), a LIKE
    // over the key. On Postgres that must match exactly the keys under the
    // prefix, with `_` and `%` in a key taken literally, and it must be able to
    // use the key index, so listing ids never reads an image value. On CI's tiny
    // table the planner rightly prefers a sequential scan, so the plan is checked
    // with enable_seqscan off: the index must be USABLE (production's plan was
    // checked with EXPLAIN on 2026-10-13).
    pgTest('kv.keys lists exactly a key prefix, literally, and can use the key index', async () => {
        await seed('pgit:img:avatar:a', 'data:a');
        await seed('pgit:img:avatar:b_c', 'data:b');
        await seed('pgit:img:avatar_x:z', 'data:other-prefix');
        await seed('pgit:img:avatarx:no', 'data:other-prefix');
        // Only an unescaped `_` (LIKE's any-one-character) would match this one.
        await seed('pgit:img:avatar-x:no', 'data:other-prefix');
        await seed('pgit:img:avatar%:no', 'data:other-prefix');
        await seed('pgit:imgfields:avatar', { 'avatar:a': 'data:legacy' });
        await seed('pgit:img:avatar:gone', 'data:expired', 'past');
        assert.deepEqual((await storage.kv.keys('pgit:img:avatar:*')).sort(), ['pgit:img:avatar:a', 'pgit:img:avatar:b_c']);
        assert.deepEqual(await storage.kv.keys('pgit:img:avatar_x:*'), ['pgit:img:avatar_x:z'], '`_` in a pattern is literal');
        assert.deepEqual(await storage.kv.keys('pgit:img:avatar%:*'), ['pgit:img:avatar%:no'], '`%` in a pattern is literal');

        await admin.query('BEGIN');
        try {
            await admin.query('SET LOCAL enable_seqscan = off');
            // The statement kv.keys runs, with its parameter, as the app sends it.
            const { rows } = await admin.query<{ 'QUERY PLAN': string }>(
                'EXPLAIN SELECT key FROM public.kv_store WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > now())',
                ['pgit:img:avatar:%'],
            );
            const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
            // A plain or bitmap index scan: either way only matching keys are visited.
            assert.match(plan, /(?:Index (?:Only )?Scan using|Bitmap Index Scan on) kv_store_key_pattern_idx/, plan);
            // The prefix becomes a key range: >= the prefix and < the prefix with
            // its last character incremented (':' + 1 = ';').
            assert.match(plan, /key ~>=~ 'pgit:img:avatar:'/, plan);
            assert.match(plan, /key ~<~ 'pgit:img:avatar;'/, plan);
            assert.doesNotMatch(plan, /Sort|Aggregate|Hash/, plan);
        } finally {
            await admin.query('ROLLBACK');
        }
    });

    // Era receipt-backed contributions (api/_era.ts) commit a receipt row and a
    // counter-row update in one compareSetMany. The memory store runs them one
    // at a time; only Postgres shows settlements racing for one counter row,
    // where a refused write must retry and nothing may be lost or counted twice.
    pgTest('Era receipts racing for one counter row each count exactly once, with a 30-day receipt', async () => {
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        const era = await import('./_era.js');
        // As many receipts as the retry budget covers, all on ONE counter row.
        const shard = era.eraReceiptShard('pgit-war-0');
        const ids: string[] = [];
        for (let n = 0; ids.length < era.ERA_RECEIPT_WRITE_ATTEMPTS; n++) {
            if (era.eraReceiptShard(`pgit-war-${n}`) === shard) ids.push(`pgit-war-${n}`);
        }
        const counterKey = `era:contrib-sum:warBattles:${shard}`;

        // Hold every writer after its first read of the counter row, so all of
        // them build their first write on the same total: the worst race.
        const getDescriptor = Object.getOwnPropertyDescriptor(storage.kv, 'get')!;
        const manyDescriptor = Object.getOwnPropertyDescriptor(storage.kv, 'compareSetMany')!;
        const realGet = storage.kv.get.bind(storage.kv);
        const realMany = storage.kv.compareSetMany!.bind(storage.kv);
        let held = 0;
        let releaseAll!: () => void;
        const barrier = new Promise<void>((resolve) => { releaseAll = resolve; });
        let refused = 0;
        Object.defineProperty(storage.kv, 'get', {
            configurable: true, writable: true,
            value: async (key: string) => {
                const value = await realGet(key);
                if (key === counterKey && held < ids.length) {
                    held += 1;
                    if (held === ids.length) releaseAll();
                    await barrier;
                }
                return value;
            },
        });
        Object.defineProperty(storage.kv, 'compareSetMany', {
            configurable: true, writable: true,
            value: async (ops: readonly KvCasOp[]) => {
                const committed = await realMany(ops);
                if (!committed) refused += 1;
                return committed;
            },
        });
        try {
            const results = await Promise.all(ids.map((id) => era.bumpEraContributionOnce('warBattles', id)));
            assert.deepEqual(results, ids.map(() => true), 'every racing settlement is confirmed');
            // Control: the race really happened. Seven of the eight first writes
            // were built on a total that another settlement had already moved.
            assert.ok(refused >= ids.length - 1, `expected at least ${ids.length - 1} refused writes, saw ${refused}`);

            const refusedBeforeReplay = refused;
            const replays = await Promise.all(ids.map((id) => era.bumpEraContributionOnce('warBattles', id)));
            assert.deepEqual(replays, ids.map(() => true));
            assert.equal(refused, refusedBeforeReplay, 'a replay finds its receipt and writes nothing');

            assert.equal((await era.readEraContributions()).warBattles, ids.length);
            const counter = await row(counterKey);
            assert.equal(counter?.value, ids.length);
            assert.equal(counter?.expires_at, null, 'the counter row never expires');
            const { rows: [receipts] } = await admin.query<{ n: number; min_days: number; max_days: number }>(
                `SELECT count(*)::int AS n,
                        min(extract(epoch FROM expires_at - now()) / 86400)::float8 AS min_days,
                        max(extract(epoch FROM expires_at - now()) / 86400)::float8 AS max_days
                   FROM public.kv_store WHERE key LIKE 'era:receipt:warBattles:pgit-war-%'`,
            );
            assert.equal(receipts.n, ids.length);
            assert.ok(receipts.min_days > 29.9 && receipts.max_days <= 30.001,
                `receipts expire in 30 days, saw ${receipts.min_days}..${receipts.max_days}`);
        } finally {
            Object.defineProperty(storage.kv, 'get', getDescriptor);
            Object.defineProperty(storage.kv, 'compareSetMany', manyDescriptor);
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });
});
