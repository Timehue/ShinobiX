import assert from 'node:assert/strict';
import pg from 'pg';

/** Opt-in integration fixture owned by scripts/test-with-postgres.mjs.
 * Each suite gets its own empty database; ordinary CI tests remain isolated QA.
 */
export function configureDisposablePgTest(suite: 'anbu' | 'hollow'): boolean {
    process.env.NODE_ENV = 'test';
    if (process.env.SHINOBIX_QA_DISPOSABLE_PG !== '1') {
        process.env.SHINOBIX_QA_MEMORY_KV = '1';
        return false;
    }
    const address = process.env.PG_INTEGRATION_DATABASE_URL;
    assert(address, 'Use test-with-postgres.mjs --underground-api to create the test databases.');
    const url = new URL(address);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/kv_integration');
    url.pathname = `/kv_integration_${suite}`;
    process.env.DATABASE_URL = url.href;
    process.env.PG_SSL = 'disable';
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    return true;
}

export async function assertEmptyDisposablePg(): Promise<void> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10_000 });
    try {
        await client.connect();
        assert.equal((await client.query('SELECT count(*)::int AS n FROM public.kv_store')).rows[0].n, 0, 'Refusing a non-empty integration database.');
        console.log(`[underground-pg] PostgreSQL ${(await client.query('SHOW server_version')).rows[0].server_version}; empty ${process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : ''}`);
    } finally { await client.end(); }
}

/** Independently read SQL after the API tests, so an accidental memory fallback
 * cannot present itself as a successful real-storage integration run. */
export async function assertDisposablePgStoredRecords(): Promise<void> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10_000 });
    try {
        await client.connect();
        const count = (await client.query('SELECT count(*)::int AS n FROM public.kv_store')).rows[0].n;
        assert(count > 0, 'The API suite must persist records in its real Postgres database.');
        console.log(`[underground-pg] ${new URL(process.env.DATABASE_URL!).pathname.slice(1)} persisted ${count} real SQL rows`);
    } finally { await client.end(); }
}

export async function finishDisposablePgTest(): Promise<void> {
    // Match production shutdown: finish queued analytics before closing storage.
    await (await import('./_beta-metrics.js')).flushBetaMetrics();
    await assertDisposablePgStoredRecords();
    await (await import('./_storage.js')).closeStoragePool();
}
