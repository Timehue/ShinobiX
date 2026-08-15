import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
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
    const patterns = payload.overlay.patterns;
    if (!Array.isArray(patterns)
        || patterns.length !== OVERLAY_PATTERNS.length
        || new Set(patterns).size !== OVERLAY_PATTERNS.length
        || OVERLAY_PATTERNS.some((pattern) => !patterns.includes(pattern))) {
        throw new Error('Overlay prefix coverage is incomplete.');
    }
    const keys = payload.overlay.entries.map((entry) => entry.key);
    if (new Set(keys).size !== keys.length || keys.some((key) => typeof key !== 'string' || !OVERLAY_PATTERNS.some((pattern) => key.startsWith(pattern.slice(0, -1))))) {
        throw new Error('Overlay contains duplicate or out-of-scope keys.');
    }
    validateBackupStorageTopology(payload.base.rows, payload.overlay.entries);
    return payload;
}

function safeKeyLabel(key) {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function categoryForKey(key) {
    if (/^save:clan-/i.test(key) || /^clan:/i.test(key)) return 'clan';
    if (/^save:(?!admin\d*$|health-probe-)/i.test(key)) return 'player-save';
    if (/^pet-sanctuary:/i.test(key)) return 'pet-sanctuary';
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

/**
 * Describe the authoritative save store represented by a backup/restore pair.
 *
 * A non-empty overlay means the retired cPanel topology was deliberately
 * captured and must remain authoritative for every disk-routed prefix during a
 * rollback drill. An explicitly empty overlay is the current production shape:
 * saves live in the PostgreSQL base and enabling DISK_KV_DIR would hide them.
 */
export function backupStorageTopology(baseRows, overlayEntries) {
    const baseSaveCount = baseRows.filter((row) => String(row.key).startsWith('save:')).length;
    const overlaySaveCount = overlayEntries.filter((entry) => String(entry.key).startsWith('save:')).length;
    const enableDiskOverlay = overlayEntries.length > 0;
    return {
        expectedSaveStore: enableDiskOverlay ? 'disk' : 'base-store',
        enableDiskOverlay,
        baseSaveCount,
        overlaySaveCount,
        // Count the saves in the store that the restored application will
        // actually read. Do not add the stores: a rollback backup may contain a
        // stale/base copy of a save whose authoritative value is in the overlay.
        saveCount: enableDiskOverlay ? overlaySaveCount : baseSaveCount,
    };
}

/**
 * Reject a payload whose selected application store would hide every save, or
 * would hide save keys that exist only in the base store. Duplicate base rows
 * remain valid for retired-overlay rollback backups when the overlay contains
 * the same keys and is therefore unambiguously authoritative.
 */
export function validateBackupStorageTopology(baseRows, overlayEntries) {
    const topology = backupStorageTopology(baseRows, overlayEntries);
    if (!topology.enableDiskOverlay) {
        if (topology.baseSaveCount === 0) {
            throw new Error('Base-only backup contains no save:* keys; refusing an incomplete backup.');
        }
        return topology;
    }
    if (topology.overlaySaveCount === 0) {
        throw new Error('Overlay backup contains no overlay save:* keys; enabling it would hide base-store saves.');
    }
    const overlayKeys = new Set(overlayEntries.map((entry) => String(entry.key)));
    const overlaySaveKeys = new Set(
        overlayEntries.filter((entry) => String(entry.key).startsWith('save:')).map((entry) => String(entry.key)),
    );
    const hiddenBaseSaveCount = baseRows.filter(
        (row) => String(row.key).startsWith('save:') && !overlaySaveKeys.has(String(row.key)),
    ).length;
    if (hiddenBaseSaveCount > 0) {
        throw new Error(`Overlay backup would hide ${hiddenBaseSaveCount} base-only save:* key(s); refusing a split-store restore.`);
    }
    const hiddenBaseRoutedCount = baseRows.filter((row) => {
        const key = String(row.key);
        return OVERLAY_PATTERNS.some((pattern) => key.startsWith(pattern.slice(0, -1))) && !overlayKeys.has(key);
    }).length;
    if (hiddenBaseRoutedCount > 0) {
        throw new Error(`Overlay backup would hide ${hiddenBaseRoutedCount} base-only disk-routed key(s); refusing a split-store restore.`);
    }
    return topology;
}

export function restoreApplicationStoragePlan(baseRows, overlayEntries, overlayRoot = null) {
    const topology = validateBackupStorageTopology(baseRows, overlayEntries);
    if (topology.enableDiskOverlay && !overlayRoot) {
        throw new Error('A backup with overlay records requires a restored overlay directory.');
    }
    const targetOverlayDir = topology.enableDiskOverlay ? resolve(overlayRoot) : null;
    return {
        ...topology,
        targetOverlay: topology.enableDiskOverlay
            ? { kind: 'disk', pathHash: safeKeyLabel(targetOverlayDir) }
            : { kind: 'none' },
        targetOverlayDir,
        applicationValidation: {
            expectedSaveStore: topology.expectedSaveStore,
            enableDiskOverlay: topology.enableDiskOverlay,
            requireDiskOverlay: topology.enableDiskOverlay,
        },
    };
}

function argsOf(argv) {
    const values = new Map();
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const current = values.get(token) ?? [];
        const next = argv[i + 1];
        current.push(next && !next.startsWith('--') ? next : '');
        values.set(token, current);
        if (next && !next.startsWith('--')) i += 1;
    }
    return {
        one(name) { return values.get(name)?.at(-1) ?? ''; },
        all(name) { return values.get(name) ?? []; },
        has(name) { return values.has(name); },
    };
}

function redactConnection(url) {
    if (!url) return null;
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const username = decodeURIComponent(parsed.username);
    const pooler = /(^|\.)pooler\.supabase\.com$/i.test(host);
    const directProject = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(host)?.[1] ?? null;
    const poolerProject = pooler && username.includes('.') ? username.slice(username.lastIndexOf('.') + 1) : null;
    const supabaseProject = directProject || poolerProject;
    return {
        protocol: parsed.protocol,
        host,
        port: parsed.port || '5432',
        database: parsed.pathname.replace(/^\//, ''),
        userHash: safeKeyLabel(username),
        supabaseProjectHash: supabaseProject ? safeKeyLabel(supabaseProject.toLowerCase()) : null,
        sharedSupabasePooler: pooler,
    };
}

export function sameConnection(sourceUrl, targetUrl) {
    if (!sourceUrl || !targetUrl) return false;
    const source = redactConnection(sourceUrl);
    const target = redactConnection(targetUrl);
    if (source.database !== target.database) return false;
    if (source.supabaseProjectHash && target.supabaseProjectHash) {
        return source.supabaseProjectHash === target.supabaseProjectHash;
    }
    if (source.protocol !== target.protocol || source.host !== target.host || source.port !== target.port) return false;
    // A Supabase pooler endpoint is shared by many projects. If a project ref
    // cannot be parsed, only an identical user is safe to classify as the same
    // target; generic PostgreSQL endpoints still identify one database across
    // multiple roles and remain fail-closed.
    if (source.sharedSupabasePooler || target.sharedSupabasePooler) return source.userHash === target.userHash;
    return true;
}

/** Compare connected identities without treating a shared Supabase pooler host
 * or server address as proof that two project-scoped databases are the same. */
export function sameDatabaseIdentity(source, target) {
    if (!source || !target || source.database !== target.database) return false;
    const sourceProject = source.endpoint?.supabaseProjectHash;
    const targetProject = target.endpoint?.supabaseProjectHash;
    if (sourceProject && targetProject) return sourceProject === targetProject;
    if (source.endpoint?.sharedSupabasePooler || target.endpoint?.sharedSupabasePooler) {
        return source.endpoint?.host === target.endpoint?.host
            && source.endpoint?.port === target.endpoint?.port
            && source.endpoint?.database === target.endpoint?.database
            && source.endpoint?.userHash === target.endpoint?.userHash;
    }
    return source.serverAddressHash === target.serverAddressHash;
}

export function validatedProxyBase(raw) {
    if (!raw) throw new Error('KV_PROXY_URL is required for a complete backup.');
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    if (parsed.protocol !== 'https:' || !APPROVED_SOURCE_PROXY_BASES.has(host) || path !== '/api/kv') {
        throw new Error('KV_PROXY_URL must be the approved HTTPS legacy /api/kv endpoint.');
    }
    if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('KV_PROXY_URL must not contain credentials, a port, query, or fragment.');
    }
    return APPROVED_SOURCE_PROXY_BASES.get(host);
}

export function resolveOverlayExportPlan(rawProxyUrl, allowLegacyOverlay = false) {
    if (!rawProxyUrl) {
        if (allowLegacyOverlay) throw new Error('--legacy-overlay requires KV_PROXY_URL for the reviewed rollback source.');
        return { kind: 'base-only' };
    }
    if (!allowLegacyOverlay) {
        throw new Error('KV_PROXY_URL is set without explicit legacy-overlay export intent; unset it or pass --legacy-overlay for a reviewed rollback capture.');
    }
    return { kind: 'legacy-overlay', proxyBase: validatedProxyBase(rawProxyUrl) };
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

async function exportStableOverlay(allowLegacyOverlay = false) {
    // Post-cPanel-retirement topology (docs/RETIRE_CPANEL_RUNBOOK.md): with no
    // overlay proxy configured, save:*/shared:images*/shared:imgfields* live in
    // the BASE store and are captured by the base-row export. Record an
    // explicitly empty overlay so the v2 format stays valid end-to-end
    // (inspect/restore/drill all handle zero overlay entries), instead of
    // failing the whole backup for a store that no longer exists. Export-time
    // completeness is still enforced in exportBackup: a backup with no save:*
    // keys in EITHER store is refused.
    const exportPlan = resolveOverlayExportPlan(process.env.KV_PROXY_URL, allowLegacyOverlay);
    if (exportPlan.kind === 'base-only') {
        return {
            source: { kind: 'retired-base-only' },
            patterns: OVERLAY_PATTERNS,
            consistencyPasses: 0,
            keyCount: 0,
            saveCount: 0,
            sha256: digestOverlay([]),
            entries: [],
        };
    }
    const base = exportPlan.proxyBase;
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

async function exportBackup(outPath, { legacyOverlay = false } = {}) {
    if (!outPath) throw new Error('Pass --out <backup.json.gz>.');
    const started = Date.now();
    const client = await connect(process.env.DATABASE_URL, 'DATABASE_URL');
    try {
        const source = await identity(client, process.env.DATABASE_URL);
        const { rows, overlay, consistencyAttempt } = await captureBracketedStores(
            async () => (await client.query(`select key, value, expires_at, updated_at from public.kv_store order by key`)).rows,
            () => exportStableOverlay(legacyOverlay),
        );
        // Completeness guard: live player saves must be present SOMEWHERE. With
        // the overlay retired they live in the base rows; a backup that finds
        // them in neither store is capturing the wrong database.
        if (!overlay.entries.length && !rows.some((row) => String(row.key).startsWith('save:'))) {
            throw new Error('Backup contains no save:* keys in either store; refusing an incomplete backup.');
        }
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
    try {
        for (const entry of entries) {
            const target = diskPath(absolute, entry.key);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, JSON.stringify({ value: entry.value, expires_at: null }));
        }
        return absolute;
    } catch (error) {
        await throwAfterOverlayCleanup(absolute, error);
    }
}

/** Do not create or advertise an empty overlay for current base-store backups. */
export async function prepareRestoreOverlay(entries) {
    return entries.length ? writeOverlayDirectory(entries) : null;
}

/** Remove only a directory created by writeOverlayDirectory. */
export async function removeRestoreOverlayDirectory(root) {
    if (!root) return;
    const absolute = resolve(root);
    const temporaryRoot = resolve(tmpdir());
    if (dirname(absolute) !== temporaryRoot || !basename(absolute).startsWith('shinobix-restore-overlay-')) {
        throw new Error('Refusing to remove a path outside the managed restore-overlay directory.');
    }
    await rm(absolute, { recursive: true, force: true });
}

async function throwAfterOverlayCleanup(root, error) {
    try {
        await removeRestoreOverlayDirectory(root);
    } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Restore failed and temporary overlay cleanup also failed.');
    }
    throw error;
}

/** Keep the staged overlay only after all downstream restore work succeeds. */
export async function withPreparedRestoreOverlay(entries, operation) {
    const overlayRoot = await prepareRestoreOverlay(entries);
    try {
        return await operation(overlayRoot);
    } catch (error) {
        await throwAfterOverlayCleanup(overlayRoot, error);
    }
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

export async function verifyRestoreRepresentatives(target, overlayRoot, payload, requestedKeys) {
    const expected = representativeRecords(allRecords(payload), requestedKeys);
    const baseByLabel = new Map(payload.base.rows.map((row) => [safeKeyLabel(row.key), row]));
    const overlayByLabel = new Map(payload.overlay.entries.map((entry) => [safeKeyLabel(entry.key), entry]));
    for (const sample of expected) {
        let value;
        if (sample.store === 'overlay') {
            if (!overlayRoot) throw new Error('Overlay representative cannot be verified without a restored overlay directory.');
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
            if (sameDatabaseIdentity(sourceId, targetId)) {
                throw new Error('Refusing to restore into the source database.');
            }
        }
        await inspectTargetSchema(target);
        const count = Number((await target.query(`select count(*)::int n from public.kv_store`)).rows[0].n);
        if (count > 0) throw new Error('Target kv_store is not empty; refusing overwrite.');
        return await withPreparedRestoreOverlay(payload.overlay.entries, async (overlayRoot) => {
            let transactionOpen = false;
            try {
                await target.query('begin');
                transactionOpen = true;
                for (const row of payload.base.rows) {
                    await target.query(`insert into public.kv_store(key,value,expires_at,updated_at) values($1,$2::jsonb,$3,$4)`, [row.key, JSON.stringify(row.value), row.expires_at, row.updated_at]);
                }
                // Verify through the same transaction before making the restored base
                // durable. A checksum or representative mismatch can then roll the
                // entire target back instead of leaving a populated failed drill.
                const { rows } = await target.query(`select key, value, expires_at, updated_at from public.kv_store order by key`);
                const restoredOverlay = overlayRoot ? await readOverlayDirectory(overlayRoot) : [];
                if (rows.length !== payload.base.rowCount || digestRows(rows) !== payload.base.sha256) throw new Error('Post-restore base-store verification mismatch.');
                if (restoredOverlay.length !== payload.overlay.keyCount || digestOverlay(restoredOverlay) !== payload.overlay.sha256) throw new Error('Post-restore overlay verification mismatch.');
                const representatives = await verifyRestoreRepresentatives(target, overlayRoot, payload, requestedKeys);
                const storagePlan = restoreApplicationStoragePlan(rows, restoredOverlay, overlayRoot);
                await target.query('commit');
                transactionOpen = false;
                return {
                    file, target: targetId, targetOverlay: storagePlan.targetOverlay, targetOverlayDir: storagePlan.targetOverlayDir,
                    applicationValidation: storagePlan.applicationValidation,
                    baseRowCount: rows.length, overlayKeyCount: restoredOverlay.length,
                    saveCount: storagePlan.saveCount, baseSaveCount: storagePlan.baseSaveCount, overlaySaveCount: storagePlan.overlaySaveCount,
                    baseSha256: digestRows(rows), overlaySha256: digestOverlay(restoredOverlay), representatives,
                    durationMs: Date.now() - started,
                };
            } catch (error) {
                if (transactionOpen) await target.query('rollback').catch(() => undefined);
                throw error;
            }
        });
    } finally {
        if (sourceClient) await sourceClient.end().catch(() => undefined);
        await target.end().catch(() => undefined);
    }
}

async function run(argv = process.argv.slice(2)) {
    const [mode, ...rest] = argv;
    const args = argsOf(rest);
    if (mode === 'export') {
        const out = await exportBackup(args.one('--out'), { legacyOverlay: args.has('--legacy-overlay') });
        const topology = backupStorageTopology(out.payload.base.rows, out.payload.overlay.entries);
        console.log(JSON.stringify({ ok: true, mode, file: out.file, durationMs: out.durationMs, baseRowCount: out.payload.base.rowCount, overlayKeyCount: out.payload.overlay.keyCount, saveCount: topology.saveCount, baseSaveCount: topology.baseSaveCount, overlaySaveCount: topology.overlaySaveCount, expectedSaveStore: topology.expectedSaveStore, baseSha256: out.payload.base.sha256, overlaySha256: out.payload.overlay.sha256 }));
        return;
    }
    if (mode === 'inspect') {
        const { payload, file } = await readBackup(args.one('--in'));
        const topology = backupStorageTopology(payload.base.rows, payload.overlay.entries);
        console.log(JSON.stringify({ ok: true, mode, file, createdAt: payload.createdAt, baseRowCount: payload.base.rowCount, overlayKeyCount: payload.overlay.keyCount, saveCount: topology.saveCount, baseSaveCount: topology.baseSaveCount, overlaySaveCount: topology.overlaySaveCount, expectedSaveStore: topology.expectedSaveStore, baseSha256: payload.base.sha256, overlaySha256: payload.overlay.sha256, representatives: representativeRecords(allRecords(payload), args.all('--representative-key')) }));
        return;
    }
    if (mode === 'restore') {
        let out;
        try {
            out = await restoreBackup(args.one('--in'), args.all('--representative-key'));
            console.log(JSON.stringify({ ok: true, mode, ...out }));
            return;
        } catch (error) {
            await throwAfterOverlayCleanup(out?.targetOverlayDir, error);
        }
    }
    if (mode === 'drill') {
        let restored;
        try {
            const drillStartedAt = new Date();
            const exported = await exportBackup(args.one('--out'), { legacyOverlay: args.has('--legacy-overlay') });
            restored = await restoreBackup(exported.file, args.all('--representative-key'));
            const completedAt = new Date();
            const evidence = {
                format: 'shinobix-restore-evidence-v2', ok: true,
                drillStartedAt: drillStartedAt.toISOString(), completedAt: completedAt.toISOString(),
                totalDurationMs: completedAt.getTime() - drillStartedAt.getTime(), exportDurationMs: exported.durationMs,
                restoreDurationMs: restored.durationMs, recoveryPointAgeMsAtCompletion: completedAt.getTime() - new Date(exported.payload.createdAt).getTime(),
                source: { base: exported.payload.source, overlay: exported.payload.overlay.source },
                target: { base: restored.target, overlay: restored.targetOverlay },
                sourceAndTargetDiffer: JSON.stringify(exported.payload.source.endpoint) !== JSON.stringify(restored.target.endpoint),
                baseRowCount: restored.baseRowCount, overlayKeyCount: restored.overlayKeyCount,
                saveCount: restored.saveCount, baseSaveCount: restored.baseSaveCount, overlaySaveCount: restored.overlaySaveCount,
                applicationValidation: restored.applicationValidation,
                baseSha256: restored.baseSha256, overlaySha256: restored.overlaySha256,
                fullDatasetVerified: restored.baseSha256 === exported.payload.base.sha256 && restored.overlaySha256 === exported.payload.overlay.sha256,
                representatives: restored.representatives,
            };
            if (!evidence.sourceAndTargetDiffer || !evidence.fullDatasetVerified) throw new Error('Restore evidence invariants failed.');
            const evidenceFile = await writeJson(args.one('--evidence-out') || 'release-audit/evidence/backup-restore.json', evidence);
            console.log(JSON.stringify({ ok: true, mode, evidenceFile, targetOverlayDir: restored.targetOverlayDir, ...evidence }));
            return;
        } catch (error) {
            await throwAfterOverlayCleanup(restored?.targetOverlayDir, error);
        }
    }
    throw new Error('Usage: kv-backup.mjs export --out <file> [--legacy-overlay] | inspect --in <file> | restore --in <file> | drill --out <file> --evidence-out <file> [--legacy-overlay]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    run().catch((error) => {
        console.error(`kv-backup: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
