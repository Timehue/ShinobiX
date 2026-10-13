import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join, resolve, sep } from 'node:path';
import pg from 'pg';

// Local counterpart of CI's postgres:16 service. Supply installed or portable
// binaries; this never installs a service or connects to an existing database.
const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log('node scripts/test-with-postgres.mjs --pg-bin=PATH [--integration-only | --stronghold-multiplayer | --underground-api] [--output=PATH]');
    console.log('Default: full CI suite. --integration-only: the 14 real-Postgres storage tests.');
    console.log('--stronghold-multiplayer: authenticated mobile browsers and concurrent players backed by fresh Postgres.');
    console.log('--underground-api: Anbu recovery/queue and cave traveler integration tests against fresh Postgres.');
    process.exit(0);
}
for (const arg of args) {
    if (!arg.startsWith('--pg-bin=') && !arg.startsWith('--output=') && !['--integration-only', '--stronghold-multiplayer', '--underground-api'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
}
const multiplayer = args.includes('--stronghold-multiplayer');
const undergroundApi = args.includes('--underground-api');
if (['--integration-only', '--stronghold-multiplayer', '--underground-api'].filter(arg => args.includes(arg)).length > 1) throw new Error('Choose one test mode.');
const outputArg = args.find(arg => arg.startsWith('--output='));
if (outputArg && !multiplayer) throw new Error('--output applies only to --stronghold-multiplayer.');
const root = resolve(import.meta.dirname, '..');
const databaseNames = undergroundApi ? ['kv_integration', 'kv_integration_anbu', 'kv_integration_hollow'] : ['kv_integration'];
const suppliedBin = args.find(arg => arg.startsWith('--pg-bin='))?.slice('--pg-bin='.length) ?? process.env.PG_TEST_BIN;
if (!suppliedBin) throw new Error('Supply --pg-bin=PATH or PG_TEST_BIN pointing to Postgres 16 bin (initdb and pg_ctl).');
const bin = resolve(root, suppliedBin);
const executable = name => join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
for (const name of ['initdb', 'pg_ctl']) {
    if (!existsSync(executable(name))) throw new Error(`Missing ${executable(name)}`);
}
const version = spawnSync(executable('initdb'), ['--version'], { encoding: 'utf8', windowsHide: true });
if (version.error) throw version.error;
if (version.status !== 0 || !/\(PostgreSQL\) 16\./.test(version.stdout)) throw new Error('Postgres 16 is required to match the CI service.');
console.log(`[local-postgres] ${version.stdout.trim()}`);

const scratch = join(root, '.tmp');
mkdirSync(scratch, { recursive: true });
const temporary = mkdtempSync(join(scratch, 'pg-tests-'));
const data = join(temporary, 'data');
const passwordFile = join(temporary, 'password');
const password = randomBytes(24).toString('hex');
const listener = createServer();
let startRequested = false;
let stopped = false;
let exitCode = 1;
const command = (name, commandArgs) => {
    const result = spawnSync(executable(name), commandArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${name} exited ${result.status}`);
};
try {
    await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
    const port = listener.address().port;
    await new Promise((done, reject) => listener.close(error => error ? reject(error) : done()));
    writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
    command('initdb', ['-D', data, '-U', 'kv_integration', '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    startRequested = true;
    command('pg_ctl', ['start', '-D', data, '-l', join(temporary, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30']);

    const admin = new pg.Client({ host: '127.0.0.1', port, user: 'kv_integration', password, database: 'postgres', ssl: false, connectionTimeoutMillis: 10_000 });
    try {
        await admin.connect();
        for (const databaseName of databaseNames) await admin.query(`CREATE DATABASE ${databaseName}`);
        console.log(`[local-postgres] server ${(await admin.query('SHOW server_version')).rows[0].server_version}; fresh database on loopback port ${port}`);
    } finally {
        await admin.end();
    }

    if (multiplayer || undergroundApi) {
        // The browser/API harness needs the same minimal real schema as the
        // storage suite, without Supabase roles or pg_cron. Read it verbatim.
        const schema = readFileSync(join(root, 'supabase-schema.sql'), 'utf8').replaceAll('\r\n', '\n');
        for (const databaseName of databaseNames) {
            const database = new pg.Client({ host: '127.0.0.1', port, user: 'kv_integration', password, database: databaseName, ssl: false });
            try {
                await database.connect();
                const definitions = [['create table if not exists public.kv_store (', '\n);'],
                    ...['kv_set_nx', 'kv_compare_set', 'kv_incr', 'kv_hset', 'kv_hdel', 'kv_delete_expired'].map(name => [`create or replace function public.${name}(`, '\n$$;'])];
                for (const [start, end] of definitions) {
                    const from = schema.indexOf(start), to = from < 0 ? -1 : schema.indexOf(end, from);
                    if (from < 0 || to < 0) throw new Error(`Missing test schema definition: ${start}`);
                    await database.query(schema.slice(from, to + end.length));
                }
            } finally { await database.end(); }
        }
    }

    const testArgs = multiplayer
        ? ['--import', 'tsx', 'scripts/stronghold-multiplayer-qa.mjs', '--postgres', ...(outputArg ? [outputArg] : [])]
        : undergroundApi ? ['--import', 'tsx', '--import', './scripts/test-asset-hooks.mjs', '--test', '--test-concurrency=1', 'api/village/anbu-async-recovery.test.ts', 'api/hollow-gate/_wanderers.integration.test.ts']
        : args.includes('--integration-only')
        ? ['--import', 'tsx', '--test', 'api/_storage-compare-set-many.pg-integration.test.ts']
        : ['--import', 'tsx', 'scripts/run-tests.mjs']; // The exact test:ci runner.
    const env = {
        ...process.env,
        PG_INTEGRATION_DATABASE_URL: `postgresql://kv_integration:${password}@127.0.0.1:${port}/kv_integration`,
        PG_INTEGRATION_REQUIRED: '1',
        SHINOBIX_QA_DISPOSABLE_PG: (multiplayer || undergroundApi) ? '1' : '0',
    };
    // Tests configure their own storage. Do not forward a developer's live
    // application storage credentials to unrelated children in the full suite.
    for (const key of ['DATABASE_URL', 'SUPABASE_POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key];
    // The default is the WHOLE suite, even from a shell used for a CI shard.
    delete env.TEST_SHARD_TOTAL;
    delete env.TEST_SHARD_INDEX;
    const result = spawnSync(process.execPath, testArgs, { cwd: multiplayer ? join(root, 'shinobij.client') : root, env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    exitCode = result.status ?? 1;
} catch (error) {
    console.error(`[local-postgres] ${error instanceof Error ? error.message : String(error)}`);
} finally {
    if (listener.listening) await new Promise(done => listener.close(done));
    if (startRequested) {
        const status = spawnSync(executable('pg_ctl'), ['status', '-D', data], { windowsHide: true });
        if (status.status === 0) {
            try { command('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30']); stopped = true; }
            catch (error) { console.error(`[local-postgres] ${error.message}`); exitCode = 1; }
        } else {
            // A missing server is safe to clean; an unknown status keeps evidence.
            stopped = status.status === 3;
        }
    } else {
        stopped = true;
    }
    if (stopped) {
        // Delete only this invocation's freshly created child of workspace .tmp.
        const target = realpathSync(temporary);
        const boundary = `${realpathSync(scratch)}${sep}`;
        if (!target.startsWith(boundary) || !basename(target).startsWith('pg-tests-')) throw new Error('Unsafe temporary cluster path; refusing cleanup.');
        rmSync(target, { recursive: true, force: true });
        console.log('[local-postgres] isolated server stopped; temporary cluster removed.');
    } else {
        console.error(`[local-postgres] Could not confirm shutdown; cluster retained at ${temporary}`);
        exitCode = 1;
    }
}
process.exitCode = exitCode;
