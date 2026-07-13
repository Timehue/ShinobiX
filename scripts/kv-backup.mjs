import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import pg from 'pg';

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const { Client } = pg;

export function digestRows(rows) {
    const hash = createHash('sha256');
    for (const row of rows) hash.update(JSON.stringify([row.key, row.value, row.expires_at, row.updated_at]) + '\n');
    return hash.digest('hex');
}

function digestValue(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validatePayload(payload) {
    if (payload?.format !== 'shinobix-kv-v1' || !Array.isArray(payload.rows)) throw new Error('Unsupported backup format.');
    if (payload.rowCount !== payload.rows.length) throw new Error('Backup row count mismatch.');
    if (payload.sha256 !== digestRows(payload.rows)) throw new Error('Backup checksum mismatch.');
    return payload;
}

function safeKeyLabel(key) {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function categoryForKey(key) {
    if (/^save:clan-/i.test(key) || /^clan:/i.test(key)) return 'clan';
    if (/^save:(?!admin\d*$|health-probe-)/i.test(key)) return 'player-save';
    if (/^pvp:/i.test(key)) return 'pvp';
    if (/^receipt:/i.test(key)) return 'receipt';
    if (/^(world:|sector:)/i.test(key)) return 'world';
    return 'other';
}

export function representativeRecords(rows, requestedKeys = []) {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const chosen = [];
    if (requestedKeys.length) {
        for (const key of [...new Set(requestedKeys)]) {
            const row = byKey.get(key);
            if (!row) throw new Error(`Requested representative key was not present in the backup (label ${safeKeyLabel(key)}).`);
            chosen.push(row);
        }
    } else {
        const seen = new Set();
        for (const row of rows) {
            const category = categoryForKey(row.key);
            if (category === 'other' || seen.has(category)) continue;
            seen.add(category);
            chosen.push(row);
        }
    }
    return chosen.map((row) => ({ label: safeKeyLabel(row.key), category: categoryForKey(row.key), valueSha256: digestValue(row.value) }));
}

function argsOf(argv) {
    const values = new Map();
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const current = values.get(token) ?? [];
        current.push(argv[i + 1] ?? '');
        values.set(token, current);
        i += 1;
    }
    return { one(name) { return values.get(name)?.at(-1) ?? ''; }, all(name) { return values.get(name) ?? []; } };
}

function redactConnection(url) {
    if (!url) return null;
    const parsed = new URL(url);
    return {
        protocol: parsed.protocol,
        host: parsed.hostname,
        port: parsed.port || '5432',
        database: parsed.pathname.replace(/^\//, ''),
        userHash: safeKeyLabel(decodeURIComponent(parsed.username)),
    };
}

function sameConnection(sourceUrl, targetUrl) {
    if (!sourceUrl || !targetUrl) return false;
    const source = redactConnection(sourceUrl);
    const target = redactConnection(targetUrl);
    return source.host === target.host && source.port === target.port && source.database === target.database && source.userHash === target.userHash;
}

async function connect(url, label) {
    if (!url) throw new Error(`${label} is required.`);
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    return client;
}

async function identity(client, url) {
    const { rows } = await client.query(`select current_database() db, current_user db_user, inet_server_addr()::text host, inet_server_port() port`);
    return {
        endpoint: redactConnection(url),
        database: rows[0].db,
        databaseUserHash: safeKeyLabel(rows[0].db_user),
        serverAddressHash: safeKeyLabel(`${rows[0].host}:${rows[0].port}`),
    };
}

async function writeJson(path, value) {
    const absolute = resolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, JSON.stringify(value, null, 2) + '\n');
    return absolute;
}

async function exportBackup(outPath) {
    if (!outPath) throw new Error('Pass --out <backup.json.gz>.');
    const started = Date.now();
    const client = await connect(process.env.DATABASE_URL, 'DATABASE_URL');
    try {
        const source = await identity(client, process.env.DATABASE_URL);
        const { rows } = await client.query(`select key, value, expires_at, updated_at from public.kv_store order by key`);
        const payload = {
            format: 'shinobix-kv-v1', createdAt: new Date().toISOString(), source,
            rowCount: rows.length, saveCount: rows.filter((row) => row.key.startsWith('save:')).length,
            sha256: digestRows(rows), rows,
        };
        const file = resolve(outPath);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, await zip(Buffer.from(JSON.stringify(payload)), { level: 9 }));
        return { payload, file, durationMs: Date.now() - started };
    } finally { await client.end(); }
}

async function readBackup(inPath) {
    if (!inPath) throw new Error('Pass --in <backup.json.gz>.');
    const file = resolve(inPath);
    const payload = validatePayload(JSON.parse((await unzip(await readFile(file))).toString('utf8')));
    return { payload, file };
}

async function verifyRepresentatives(target, payload, requestedKeys) {
    const expected = representativeRecords(payload.rows, requestedKeys);
    const sourceByLabel = new Map(payload.rows.map((row) => [safeKeyLabel(row.key), row]));
    for (const sample of expected) {
        const sourceRow = sourceByLabel.get(sample.label);
        const result = await target.query(`select value from public.kv_store where key = $1`, [sourceRow.key]);
        if (result.rowCount !== 1 || digestValue(result.rows[0].value) !== sample.valueSha256) {
            throw new Error(`Representative record verification failed for label ${sample.label}.`);
        }
    }
    return expected.map((sample) => ({ ...sample, verified: true }));
}

async function restoreBackup(inPath, requestedKeys = []) {
    if (process.env.ALLOW_ISOLATED_RESTORE !== '1') throw new Error('Set ALLOW_ISOLATED_RESTORE=1 for an explicitly isolated target.');
    if (sameConnection(process.env.DATABASE_URL, process.env.TARGET_DATABASE_URL)) throw new Error('Refusing to restore into the source database endpoint.');
    const started = Date.now();
    const { payload, file } = await readBackup(inPath);
    const target = await connect(process.env.TARGET_DATABASE_URL, 'TARGET_DATABASE_URL');
    let sourceClient;
    try {
        const targetId = await identity(target, process.env.TARGET_DATABASE_URL);
        if (process.env.DATABASE_URL) {
            sourceClient = await connect(process.env.DATABASE_URL, 'DATABASE_URL');
            const sourceId = await identity(sourceClient, process.env.DATABASE_URL);
            if (JSON.stringify(sourceId.endpoint) === JSON.stringify(targetId.endpoint)) throw new Error('Refusing to restore into the source database.');
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
        const representatives = await verifyRepresentatives(target, payload, requestedKeys);
        return { file, target: targetId, rowCount: rows.length, saveCount: rows.filter((row) => row.key.startsWith('save:')).length, sha256: actual, representatives, durationMs: Date.now() - started };
    } catch (error) {
        await target.query('rollback').catch(() => undefined);
        throw error;
    } finally { await sourceClient?.end(); await target.end(); }
}

async function run(argv = process.argv.slice(2)) {
    const [mode, ...rest] = argv;
    const args = argsOf(rest);
    if (mode === 'export') {
        const out = await exportBackup(args.one('--out'));
        console.log(JSON.stringify({ ok: true, mode, file: out.file, durationMs: out.durationMs, rowCount: out.payload.rowCount, saveCount: out.payload.saveCount, sha256: out.payload.sha256 }));
        return;
    }
    if (mode === 'inspect') {
        const { payload, file } = await readBackup(args.one('--in'));
        console.log(JSON.stringify({ ok: true, mode, file, createdAt: payload.createdAt, rowCount: payload.rowCount, saveCount: payload.saveCount, sha256: payload.sha256, representatives: representativeRecords(payload.rows, args.all('--representative-key')) }));
        return;
    }
    if (mode === 'restore') {
        const out = await restoreBackup(args.one('--in'), args.all('--representative-key'));
        console.log(JSON.stringify({ ok: true, mode, ...out }));
        return;
    }
    if (mode === 'drill') {
        const drillStartedAt = new Date();
        const exported = await exportBackup(args.one('--out'));
        const restored = await restoreBackup(exported.file, args.all('--representative-key'));
        const completedAt = new Date();
        const evidence = {
            format: 'shinobix-restore-evidence-v1', ok: true,
            drillStartedAt: drillStartedAt.toISOString(), completedAt: completedAt.toISOString(),
            totalDurationMs: completedAt.getTime() - drillStartedAt.getTime(),
            exportDurationMs: exported.durationMs, restoreDurationMs: restored.durationMs,
            recoveryPointAgeMsAtCompletion: completedAt.getTime() - new Date(exported.payload.createdAt).getTime(),
            source: exported.payload.source, target: restored.target,
            sourceAndTargetDiffer: JSON.stringify(exported.payload.source.endpoint) !== JSON.stringify(restored.target.endpoint),
            rowCount: restored.rowCount, saveCount: restored.saveCount, sha256: restored.sha256,
            fullDatasetVerified: restored.sha256 === exported.payload.sha256,
            representatives: restored.representatives,
        };
        if (!evidence.sourceAndTargetDiffer || !evidence.fullDatasetVerified) throw new Error('Restore evidence invariants failed.');
        const evidenceFile = await writeJson(args.one('--evidence-out') || 'release-audit/evidence/backup-restore.json', evidence);
        console.log(JSON.stringify({ ok: true, mode, evidenceFile, ...evidence }));
        return;
    }
    throw new Error('Usage: kv-backup.mjs export --out <file> | inspect --in <file> | restore --in <file> | drill --out <file> --evidence-out <file>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    run().catch((error) => {
        console.error(`kv-backup: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}

