import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import pg from 'pg';

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const { Client } = pg;
const mode = process.argv[2];
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : ''; };
const file = resolve(arg(mode === 'export' ? '--out' : '--in') || '');

function digestRows(rows) {
    const hash = createHash('sha256');
    for (const row of rows) hash.update(JSON.stringify([row.key, row.value, row.expires_at, row.updated_at]) + '\n');
    return hash.digest('hex');
}

async function connect(url, label) {
    if (!url) throw new Error(`${label} is required.`);
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return client;
}

async function identity(client) {
    const { rows } = await client.query(`select current_database() db, inet_server_addr()::text host, inet_server_port() port`);
    return rows[0];
}

async function exportBackup() {
    if (!arg('--out')) throw new Error('Usage: node scripts/kv-backup.mjs export --out backups/name.shinobix-backup.json.gz');
    const client = await connect(process.env.DATABASE_URL, 'DATABASE_URL');
    try {
        const source = await identity(client);
        const { rows } = await client.query(`select key, value, expires_at, updated_at from public.kv_store order by key`);
        const payload = {
            format: 'shinobix-kv-v1', createdAt: new Date().toISOString(), source,
            rowCount: rows.length, saveCount: rows.filter((row) => row.key.startsWith('save:')).length,
            sha256: digestRows(rows), rows,
        };
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, await zip(Buffer.from(JSON.stringify(payload)), { level: 9 }));
        console.log(JSON.stringify({ ok: true, mode: 'export', file, rowCount: payload.rowCount, saveCount: payload.saveCount, sha256: payload.sha256 }));
    } finally { await client.end(); }
}

async function readBackup() {
    if (!arg('--in')) throw new Error('Pass --in <backup.json.gz>.');
    const payload = JSON.parse((await unzip(await readFile(file))).toString('utf8'));
    if (payload.format !== 'shinobix-kv-v1' || !Array.isArray(payload.rows)) throw new Error('Unsupported backup format.');
    if (payload.rowCount !== payload.rows.length || payload.sha256 !== digestRows(payload.rows)) throw new Error('Backup checksum or row count mismatch.');
    return payload;
}

async function restoreBackup() {
    if (process.env.ALLOW_ISOLATED_RESTORE !== '1') throw new Error('Set ALLOW_ISOLATED_RESTORE=1 for an explicitly isolated target.');
    const payload = await readBackup();
    const target = await connect(process.env.TARGET_DATABASE_URL, 'TARGET_DATABASE_URL');
    let sourceClient;
    try {
        const targetId = await identity(target);
        if (process.env.DATABASE_URL) {
            sourceClient = await connect(process.env.DATABASE_URL, 'DATABASE_URL');
            const sourceId = await identity(sourceClient);
            if (JSON.stringify(sourceId) === JSON.stringify(targetId)) throw new Error('Refusing to restore into the source database.');
        }
        await target.query(`create table if not exists public.kv_store (key text primary key, value jsonb not null, expires_at timestamptz null, updated_at timestamptz not null default now())`);
        const count = Number((await target.query(`select count(*)::int n from public.kv_store`)).rows[0].n);
        if (count > 0 && process.env.ALLOW_RESTORE_OVERWRITE !== '1') throw new Error('Target kv_store is not empty; refusing overwrite.');
        await target.query('begin');
        if (count > 0) await target.query('truncate public.kv_store');
        for (const row of payload.rows) {
            await target.query(`insert into public.kv_store(key,value,expires_at,updated_at) values($1,$2::jsonb,$3,$4)`, [row.key, JSON.stringify(row.value), row.expires_at, row.updated_at]);
        }
        await target.query('commit');
        const { rows } = await target.query(`select key, value, expires_at, updated_at from public.kv_store order by key`);
        const actual = digestRows(rows);
        if (rows.length !== payload.rowCount || actual !== payload.sha256) throw new Error('Post-restore verification mismatch.');
        console.log(JSON.stringify({ ok: true, mode: 'restore', target: targetId, rowCount: rows.length, saveCount: rows.filter((row) => row.key.startsWith('save:')).length, sha256: actual }));
    } catch (error) {
        await target.query('rollback').catch(() => undefined);
        throw error;
    } finally { await sourceClient?.end(); await target.end(); }
}

try {
    if (mode === 'export') await exportBackup();
    else if (mode === 'restore') await restoreBackup();
    else throw new Error('Usage: kv-backup.mjs export --out <file> | restore --in <file>');
} catch (error) {
    console.error(`kv-backup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
