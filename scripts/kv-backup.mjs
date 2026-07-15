import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import pg from 'pg';

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const { Client } = pg;
const OVERLAY_PATTERNS = ['save:*', 'shared:images*', 'shared:imgfields*'];
const APPROVED_SOURCE_PROXY_BASES = new Map([
    ['theravensark.com', 'https://theravensark.com/api/kv'],
    ['www.theravensark.com', 'https://www.theravensark.com/api/kv'],
]);

function stableDigest(items, projector) {
    const hash = createHash('sha256');
    for (const item of items) hash.update(JSON.stringify(projector(item)) + '\n');
    return hash.digest('hex');
}

export function digestRows(rows) {
    return stableDigest(rows, (row) => [row.key, row.value, row.expires_at, row.updated_at]);
}

export function digestOverlay(entries) {
    return stableDigest(entries, (entry) => [entry.key, entry.value]);
}

function digestValue(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function validatePayload(payload) {
    if (payload?.format !== 'shinobix-kv-v2') throw new Error('Unsupported or incomplete backup format.');
    if (!Array.isArray(payload.base?.rows) || !Array.isArray(payload.overlay?.entries)) throw new Error('Backup stores are missing.');
    if (payload.base.rowCount !== payload.base.rows.length || payload.base.sha256 !== digestRows(payload.base.rows)) {
        throw new Error('Base-store checksum or row count mismatch.');
    }
    if (payload.overlay.keyCount !== payload.overlay.entries.length || payload.overlay.sha256 !== digestOverlay(payload.overlay.entries)) {
        throw new Error('Overlay checksum or key count mismatch.');
    }
    if (!payload.overlay.patterns?.every((pattern) => OVERLAY_PATTERNS.includes(pattern)) || payload.overlay.patterns.length !== OVERLAY_PATTERNS.length) {
        throw new Error('Overlay prefix coverage is incomplete.');
    }
    const keys = payload.overlay.entries.map((entry) => entry.key);
    if (new Set(keys).size !== keys.length || keys.some((key) => !OVERLAY_PATTERNS.some((pattern) => key.startsWith(pattern.slice(0, -1))))) {
        throw new Error('Overlay contains duplicate or out-of-scope keys.');
    }
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
    if (/^shared:(images|imgfields)/i.test(key)) return 'image';
    return 'other';
}

export function representativeRecords(records, requestedKeys = []) {
    const byKey = new Map();
    for (const record of records) if (!byKey.has(record.key)) byKey.set(record.key, record);
    const chosen = [];
    if (requestedKeys.length) {
        for (const key of [...new Set(requestedKeys)]) {
            const record = byKey.get(key);
            if (!record) throw new Error(`Requested representative key was not present in the backup (label ${safeKeyLabel(key)}).`);
            chosen.push(record);
        }
    } else {
        const seen = new Set();
        for (const record of byKey.values()) {
            const category = categoryForKey(record.key);
            if (category === 'other' || seen.has(category)) continue;
            seen.add(category);
            chosen.push(record);
        }
    }
    return chosen.map((record) => ({
        label: safeKeyLabel(record.key),
        category: categoryForKey(record.key),
        store: record.store,
        valueSha256: digestValue(record.value),
    }));
}

function allRecords(payload) {
    return [
        ...payload.overlay.entries.map((entry) => ({ ...entry, store: 'overlay' })),
        ...payload.base.rows.map((row) => ({ key: row.key, value: row.value, store: 'base' })),
    ];
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

export function sameConnection(sourceUrl, targetUrl) {
    if (!sourceUrl || !targetUrl) return false;
    const source = redactConnection(sourceUrl);
    const target = redactConnection(targetUrl);
    return source.protocol === target.protocol && source.host === target.host && source.port === target.port && source.database === target.database;
}

export function validatedProxyBase(raw) {
    if (!raw) throw new Error('KV_PROXY_URL is required for a complete backup.');
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    if (parsed.protocol !== 'https:' || !APPROVED_SOURCE_PROXY_BASES.has(host) || path !== '/api/kv') {
        throw new Error('KV_PROXY_URL must be the approved HTTPS production /api/kv endpoint.');
    }
    if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('KV_PROXY_URL must not contain credentials, a port, query, or fragment.');
    }
    return APPROVED_SOURCE_PROXY_BASES.get(host);
}

async function proxyCall(base, token, op, body) {
    if (!token) throw new Error('KV_PROXY_TOKEN is required for a complete backup.');
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const response = await fetch(`${base}/${op}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kv-token': token },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(120_000),
            });
            if (response.ok) return response.json();
            lastError = new Error(`KV proxy ${op} failed with HTTP ${response.status}.`);
            if (![502, 503, 504].includes(response.status)) break;
        } catch (error) {
            lastError = error;
        }
        if (attempt < 3) await new Promise((done) => setTimeout(done, attempt * 200));
    }
    throw lastError;
}

async function readOverlayOnce(base, token) {
    const keyGroups = await Promise.all(OVERLAY_PATTERNS.map(async (pattern) => (await proxyCall(base, token, 'keys', { pattern })).keys));
    const keys = [...new Set(keyGroups.flat())].sort();
    if (!keys.some((key) => key.startsWith('save:'))) throw new Error('Overlay contained no save:* keys; refusing an incomplete backup.');
    const entries = [];
    for (let offset = 0; offset < keys.length; offset += 100) {
        const batch = keys.slice(offset, offset + 100);
        const values = (await proxyCall(base, token, 'mget', { keys: batch })).values;
        if (!Array.isArray(values) || values.length !== batch.length) throw new Error('KV proxy returned an incomplete mget batch.');
        batch.forEach((key, index) => {
            if (values[index] === null) throw new Error(`Overlay key disappeared during export (label ${safeKeyLabel(key)}).`);
            entries.push({ key, value: values[index] });
        });
    }
    return entries;
}

async function exportStableOverlay() {
    const base = validatedProxyBase(process.env.KV_PROXY_URL);
    const token = process.env.KV_PROXY_TOKEN;
    let previous = await readOverlayOnce(base, token);
    for (let pass = 2; pass <= 4; pass += 1) {
        const current = await readOverlayOnce(base, token);
        if (current.length === previous.length && digestOverlay(current) === digestOverlay(previous)) {
            return {
                source: { kind: 'remote-proxy', endpoint: new URL(base).hostname },
                patterns: OVERLAY_PATTERNS,
                consistencyPasses: pass,
                keyCount: current.length,
                saveCount: current.filter((entry) => entry.key.startsWith('save:')).length,
                sha256: digestOverlay(current),
                entries: current,
            };
        }
        previous = current;
    }
    throw new Error('Overlay changed throughout the export window; enable the gameplay-mutation freeze and retry.');
}

export async function captureBracketedStores(readBase, readStableOverlay, maxAttempts = 3) {
    for (let consistencyAttempt = 1; consistencyAttempt <= maxAttempts; consistencyAttempt += 1) {
        const before = await readBase();
        const overlay = await readStableOverlay();
        const after = await readBase();
        if (before.length === after.length && digestRows(before) === digestRows(after)) {
            return { rows: after, overlay, consistencyAttempt };
        }
    }
    throw new Error('Base store changed throughout the export window; enable the gameplay-mutation freeze and retry.');
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
        endpoint: redactConnection(url), database: rows[0].db,
        databaseUserHash: safeKeyLabel(rows[0].db_user),
        serverAddressHash: safeKeyLabel(`${rows[0].host}:${rows[0].port}`),
    };
}

export function validateTargetSchemaEvidence(evidence) {
    const expectedColumns = [
        ['key', 'text', 'NO'],
        ['value', 'jsonb', 'NO'],
        ['expires_at', 'timestamp with time zone', 'YES'],
        ['updated_at', 'timestamp with time zone', 'NO'],
    ];
    const actualColumns = evidence.columns.map((column) => [column.column_name, column.data_type, column.is_nullable]);
    if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) throw new Error('Target kv_store schema does not match supabase-schema.sql.');
    for (const name of ['kv_store_pkey', 'kv_store_expires_at_idx', 'kv_store_key_pattern_idx']) {
        if (!evidence.indexes.includes(name)) throw new Error(`Target schema is missing index ${name}.`);
    }
    if (!evidence.rlsEnabled || !evidence.anonReadPolicy || !evidence.anonCanSelect || evidence.anonCanInsert || evidence.anonCanUpdate || evidence.anonCanDelete) {
        throw new Error('Target kv_store RLS or anon privileges do not match the hardened schema.');
    }
    return evidence;
}

async function inspectTargetSchema(client) {
    const columns = (await client.query(`
        select column_name, data_type, is_nullable
        from information_schema.columns
        where table_schema = 'public' and table_name = 'kv_store'
        order by ordinal_position
    `)).rows;
    const indexes = (await client.query(`
        select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'kv_store'
    `)).rows.map((row) => row.indexname);
    const controls = (await client.query(`
        select
            coalesce((select relrowsecurity from pg_class where oid = 'public.kv_store'::regclass), false) as rls_enabled,
            exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'kv_store' and policyname = 'kv_store_anon_select') as anon_read_policy,
            has_table_privilege('anon', 'public.kv_store', 'SELECT') as anon_can_select,
            has_table_privilege('anon', 'public.kv_store', 'INSERT') as anon_can_insert,
            has_table_privilege('anon', 'public.kv_store', 'UPDATE') as anon_can_update,
            has_table_privilege('anon', 'public.kv_store', 'DELETE') as anon_can_delete
    `)).rows[0];
    return validateTargetSchemaEvidence({
        columns,
        indexes,
        rlsEnabled: controls.rls_enabled,
        anonReadPolicy: controls.anon_read_policy,
        anonCanSelect: controls.anon_can_select,
        anonCanInsert: controls.anon_can_insert,
        anonCanUpdate: controls.anon_can_update,
        anonCanDelete: controls.anon_can_delete,
    });
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
        const { rows, overlay, consistencyAttempt } = await captureBracketedStores(
            async () => (await client.query(`select key, value, expires_at, updated_at from public.kv_store order by key`)).rows,
            exportStableOverlay,
        );
        const payload = {
            format: 'shinobix-kv-v2', createdAt: new Date().toISOString(), source, consistencyAttempt,
            base: { rowCount: rows.length, sha256: digestRows(rows), rows },
            overlay,
        };
        validatePayload(payload);
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

function diskPath(root, key) {
    const segments = key.split(':').map((segment) => encodeURIComponent(segment));
    if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('Unsafe overlay key segment.');
    const target = resolve(root, ...segments) + '.json';
    const safeRoot = resolve(root);
    if (!target.startsWith(safeRoot + sep)) throw new Error('Overlay key escaped the target directory.');
    return target;
}

async function listFiles(root) {
    const out = [];
    async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const full = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) out.push(full);
        }
    }
    await walk(root);
    return out;
}

export async function writeOverlayDirectory(entries) {
    const absolute = await mkdtemp(resolve(tmpdir(), 'shinobix-restore-overlay-'));
    for (const entry of entries) {
        const target = diskPath(absolute, entry.key);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify({ value: entry.value, expires_at: null }));
    }
    return absolute;
}

export async function readOverlayDirectory(root) {
    const absolute = resolve(root);
    const files = await listFiles(absolute);
    const entries = [];
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        let rel = relative(absolute, file).slice(0, -5);
        const key = rel.split(sep).map((segment) => decodeURIComponent(segment)).join(':');
        const record = JSON.parse(await readFile(file, 'utf8'));
        entries.push({ key, value: record.value });
    }
    return entries.sort((a, b) => a.key.localeCompare(b.key));
}

async function verifyRepresentatives(target, overlayRoot, payload, requestedKeys) {
    const expected = representativeRecords(allRecords(payload), requestedKeys);
    const baseByLabel = new Map(payload.base.rows.map((row) => [safeKeyLabel(row.key), row]));
    const overlayByLabel = new Map(payload.overlay.entries.map((entry) => [safeKeyLabel(entry.key), entry]));
    for (const sample of expected) {
        let value;
        if (sample.store === 'overlay') {
            const source = overlayByLabel.get(sample.label);
            value = JSON.parse(await readFile(diskPath(overlayRoot, source.key), 'utf8')).value;
        } else {
            const source = baseByLabel.get(sample.label);
            const result = await target.query(`select value from public.kv_store where key = $1`, [source.key]);
            if (result.rowCount !== 1) throw new Error(`Representative base record missing for label ${sample.label}.`);
            value = result.rows[0].value;
        }
        if (digestValue(value) !== sample.valueSha256) throw new Error(`Representative verification failed for label ${sample.label}.`);
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
            if (sourceId.endpoint.host === targetId.endpoint.host && sourceId.endpoint.port === targetId.endpoint.port && sourceId.endpoint.database === targetId.endpoint.database) {
                throw new Error('Refusing to restore into the source database.');
            }
        }
        await inspectTargetSchema(target);
        const count = Number((await target.query(`select count(*)::int n from public.kv_store`)).rows[0].n);
        if (count > 0) throw new Error('Target kv_store is not empty; refusing overwrite.');
        const overlayRoot = await writeOverlayDirectory(payload.overlay.entries);
        await target.query('begin');
        for (const row of payload.base.rows) {
            await target.query(`insert into public.kv_store(key,value,expires_at,updated_at) values($1,$2::jsonb,$3,$4)`, [row.key, JSON.stringify(row.value), row.expires_at, row.updated_at]);
        }
        // Verify through the same transaction before making the restored base
        // durable. A checksum or representative mismatch can then roll the
        // entire target back instead of leaving a populated failed drill.
        const { rows } = await target.query(`select key, value, expires_at, updated_at from public.kv_store order by key`);
        const restoredOverlay = await readOverlayDirectory(overlayRoot);
        if (rows.length !== payload.base.rowCount || digestRows(rows) !== payload.base.sha256) throw new Error('Post-restore base-store verification mismatch.');
        if (restoredOverlay.length !== payload.overlay.keyCount || digestOverlay(restoredOverlay) !== payload.overlay.sha256) throw new Error('Post-restore overlay verification mismatch.');
        const representatives = await verifyRepresentatives(target, overlayRoot, payload, requestedKeys);
        await target.query('commit');
        return {
            file, target: targetId, targetOverlay: { kind: 'disk', pathHash: safeKeyLabel(resolve(overlayRoot)) }, targetOverlayDir: overlayRoot,
            baseRowCount: rows.length, overlayKeyCount: restoredOverlay.length,
            saveCount: restoredOverlay.filter((entry) => entry.key.startsWith('save:')).length,
            baseSha256: digestRows(rows), overlaySha256: digestOverlay(restoredOverlay), representatives,
            durationMs: Date.now() - started,
        };
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
        console.log(JSON.stringify({ ok: true, mode, file: out.file, durationMs: out.durationMs, baseRowCount: out.payload.base.rowCount, overlayKeyCount: out.payload.overlay.keyCount, saveCount: out.payload.overlay.saveCount, baseSha256: out.payload.base.sha256, overlaySha256: out.payload.overlay.sha256 }));
        return;
    }
    if (mode === 'inspect') {
        const { payload, file } = await readBackup(args.one('--in'));
        console.log(JSON.stringify({ ok: true, mode, file, createdAt: payload.createdAt, baseRowCount: payload.base.rowCount, overlayKeyCount: payload.overlay.keyCount, saveCount: payload.overlay.saveCount, baseSha256: payload.base.sha256, overlaySha256: payload.overlay.sha256, representatives: representativeRecords(allRecords(payload), args.all('--representative-key')) }));
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
            format: 'shinobix-restore-evidence-v2', ok: true,
            drillStartedAt: drillStartedAt.toISOString(), completedAt: completedAt.toISOString(),
            totalDurationMs: completedAt.getTime() - drillStartedAt.getTime(), exportDurationMs: exported.durationMs,
            restoreDurationMs: restored.durationMs, recoveryPointAgeMsAtCompletion: completedAt.getTime() - new Date(exported.payload.createdAt).getTime(),
            source: { base: exported.payload.source, overlay: exported.payload.overlay.source },
            target: { base: restored.target, overlay: restored.targetOverlay },
            sourceAndTargetDiffer: JSON.stringify(exported.payload.source.endpoint) !== JSON.stringify(restored.target.endpoint),
            baseRowCount: restored.baseRowCount, overlayKeyCount: restored.overlayKeyCount, saveCount: restored.saveCount,
            baseSha256: restored.baseSha256, overlaySha256: restored.overlaySha256,
            fullDatasetVerified: restored.baseSha256 === exported.payload.base.sha256 && restored.overlaySha256 === exported.payload.overlay.sha256,
            representatives: restored.representatives,
        };
        if (!evidence.sourceAndTargetDiffer || !evidence.fullDatasetVerified) throw new Error('Restore evidence invariants failed.');
        const evidenceFile = await writeJson(args.one('--evidence-out') || 'release-audit/evidence/backup-restore.json', evidence);
        console.log(JSON.stringify({ ok: true, mode, evidenceFile, targetOverlayDir: restored.targetOverlayDir, ...evidence }));
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
