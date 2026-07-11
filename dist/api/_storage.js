"use strict";
/**
 * Dual-mode KV adapter — drop-in replacement for @vercel/kv.
 *
 * ┌──────────────┬──────────────────────────────────────────────────────┐
 * │ Environment  │ Backend                                              │
 * ├──────────────┼──────────────────────────────────────────────────────┤
 * │ cPanel /     │ pg Pool → direct Postgres.  No REST timeout; handles │
 * │ Passenger    │ 10 MB+ image blobs.  DATABASE_URL env var required.  │
 * ├──────────────┼──────────────────────────────────────────────────────┤
 * │ Vercel /     │ Supabase REST API (PostgREST).  HTTP-based; no TCP   │
 * │ serverless   │ cold-start penalty.  SUPABASE_URL +                  │
 * │              │ SUPABASE_SERVICE_ROLE_KEY env vars required.         │
 * │              │ Statement timeout raised to 120s via ALTER ROLE.     │
 * └──────────────┴──────────────────────────────────────────────────────┘
 *
 * Storage model (shared):
 *   Each key is one row in public.kv_store.
 *   String/JSON values → value column (JSONB).
 *   Hash values        → value column holds a JSON object.
 *   TTL                → expires_at (timestamptz); lazily evicted on read.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._diskKvForProxy = exports.saveStoreKind = exports.kv = void 0;
exports._makeDiskKv = _makeDiskKv;
exports._makeRemoteKv = _makeRemoteKv;
exports._makeRoutedKv = _makeRoutedKv;
exports._migrateDiskRoutedKeys = _migrateDiskRoutedKeys;
exports.migrateDiskRoutedKeysToOverlay = migrateDiskRoutedKeysToOverlay;
const _readCache = new Map();
// These prefixes change too rapidly to benefit from caching.
const _noCachePrefixes = ['presence:', 'challenges:', 'reset-signal:', 'admin-lock:', 'auth:', 'auth-session:'];
function _shouldCache(key) {
    return !_noCachePrefixes.some(p => key.startsWith(p));
}
function _cacheTtlMs(key) {
    if (key.startsWith('shared:images') || key.startsWith('shared:imgfields'))
        return 60_000;
    if (key.startsWith('world:') || key.startsWith('game:'))
        return 15_000;
    return 10_000; // saves, auth, registry, etc.
}
function _cacheRead(key) {
    if (!_shouldCache(key))
        return undefined;
    const entry = _readCache.get(key);
    if (!entry)
        return undefined;
    if (Date.now() > entry.expiresAt) {
        _readCache.delete(key);
        return undefined;
    }
    return entry.value;
}
function _cacheWrite(key, value) {
    if (!_shouldCache(key))
        return;
    _readCache.set(key, { value, expiresAt: Date.now() + _cacheTtlMs(key) });
}
function _cacheInvalidate(...keys) {
    for (const k of keys)
        _readCache.delete(k);
}
// ─── pg Pool backend (cPanel / Passenger) ────────────────────────────────────
const pg_1 = __importDefault(require("pg"));
const { Pool } = pg_1.default;
let _pool = null;
function getPool() {
    if (_pool)
        return _pool;
    // DATABASE_URL wins; fall back to SUPABASE_POSTGRES_URL (set automatically
    // by the Supabase Vercel integration on all environments).
    const url = (process.env.DATABASE_URL ?? process.env.SUPABASE_POSTGRES_URL);
    // Strip params that confuse pg: sslmode (pg v8 treats require as verify-full)
    // and pgbouncer=true (Supavisor hint for ORMs, not understood by pg driver).
    const cleanUrl = url
        .replace(/([?&])sslmode=[^&]*/g, (_, sep) => (sep === '?' ? '?' : ''))
        .replace(/([?&])pgbouncer=[^&]*/g, (_, sep) => (sep === '?' ? '?' : ''))
        .replace(/\?$/, '')
        .replace(/\?&/, '?');
    // Parse the URL manually with the WHATWG URL API instead of passing
    // connectionString. pg v8 delegates connection-string parsing to
    // pg-connection-string which calls the deprecated url.parse() internally,
    // causing Node.js to emit DEP0169 on every request. Passing individual
    // config fields bypasses that code path entirely.
    const parsed = new URL(cleanUrl);
    _pool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ''),
        // SSL on by default (Supabase requires it, as does Railway's PUBLIC proxy
        // URL). Set PG_SSL=disable ONLY when connecting over Railway's PRIVATE
        // network (host postgres.railway.internal): that listener is on an
        // isolated per-project overlay, serves plaintext, and rejects an SSL
        // handshake — so forcing SSL there fails to connect. Never disable SSL on
        // a public/internet connection string.
        ssl: process.env.PG_SSL === 'disable' ? false : { rejectUnauthorized: false },
        // Pool size PER PROCESS. cPanel/Passenger runs many small worker
        // processes, so 5 each is plenty. A single always-on Railway/VPS instance
        // serving every player's heartbeat writes wants more headroom — set
        // PG_POOL_MAX=15 (or higher) there. Default unchanged at 5.
        max: Number(process.env.PG_POOL_MAX ?? 5),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
    });
    _pool.on('error', (err) => {
        console.error('[pg pool error]', err.message);
    });
    return _pool;
}
function toSqlPattern(pattern) {
    return pattern
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/\*/g, '%')
        .replace(/\?/g, '_');
}
function expiresAt(ex) {
    return new Date(Date.now() + ex * 1000).toISOString();
}
// ─── pg implementations ───────────────────────────────────────────────────────
const pgKv = {
    async get(key) {
        const hit = _cacheRead(key);
        if (hit !== undefined)
            return hit;
        const db = getPool();
        const { rows } = await db.query(`SELECT value, expires_at FROM public.kv_store WHERE key = $1`, [key]);
        if (!rows.length) {
            _cacheWrite(key, null);
            return null;
        }
        const row = rows[0];
        if (row.expires_at && new Date(row.expires_at) <= new Date()) {
            void db.query(`DELETE FROM public.kv_store WHERE key = $1`, [key]);
            return null;
        }
        _cacheWrite(key, row.value);
        return row.value;
    },
    async set(key, value, options) {
        _cacheInvalidate(key);
        const db = getPool();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { rows } = await db.query(`SELECT public.kv_set_nx($1, $2::jsonb, $3::timestamptz) AS kv_set_nx`, [key, JSON.stringify(value), exp]);
            if (rows[0].kv_set_nx)
                _cacheWrite(key, value);
            return rows[0].kv_set_nx ? 'OK' : null;
        }
        await db.query(`INSERT INTO public.kv_store (key, value, expires_at, updated_at)
             VALUES ($1, $2::jsonb, $3::timestamptz, now())
             ON CONFLICT (key) DO UPDATE
                 SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`, [key, JSON.stringify(value), exp]);
        _cacheWrite(key, value);
        return 'OK';
    },
    async del(...keys) {
        if (!keys.length)
            return 0;
        _cacheInvalidate(...keys);
        const { rowCount } = await getPool().query(`DELETE FROM public.kv_store WHERE key = ANY($1::text[])`, [keys]);
        return rowCount ?? 0;
    },
    async incr(key, options) {
        _cacheInvalidate(key);
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { rows } = await getPool().query(`SELECT public.kv_incr($1, $2::timestamptz) AS kv_incr`, [key, exp]);
        return Number(rows[0].kv_incr);
    },
    async keys(pattern) {
        const { rows } = await getPool().query(`SELECT key FROM public.kv_store WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > now())`, [toSqlPattern(pattern)]);
        return rows.map((r) => r.key);
    },
    async mget(...keys) {
        if (!keys.length)
            return [];
        // Check cache first — only fetch keys not already cached.
        const result = new Array(keys.length).fill(null);
        const missIndices = [];
        const missKeys = [];
        for (let i = 0; i < keys.length; i++) {
            const hit = _cacheRead(keys[i]);
            if (hit !== undefined) {
                result[i] = hit;
            }
            else {
                missIndices.push(i);
                missKeys.push(keys[i]);
            }
        }
        if (missKeys.length) {
            const { rows } = await getPool().query(`SELECT key, value FROM public.kv_store WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > now())`, [missKeys]);
            const map = new Map(rows.map((r) => [r.key, r.value]));
            for (let j = 0; j < missKeys.length; j++) {
                const val = map.has(missKeys[j]) ? map.get(missKeys[j]) : null;
                result[missIndices[j]] = val;
                _cacheWrite(missKeys[j], val);
            }
        }
        return result;
    },
    async hgetall(key) {
        return pgKv.get(key);
    },
    async hkeys(key) {
        // Extract field names IN SQL — never ships the (multi-MB) value itself.
        // jsonb_object_keys errors on non-objects, so guard on jsonb_typeof.
        const { rows } = await getPool().query(`SELECT jsonb_object_keys(value) AS k FROM public.kv_store
             WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())
               AND jsonb_typeof(value) = 'object'`, [key]);
        return rows.map((r) => r.k);
    },
    async hset(key, fields) {
        _cacheInvalidate(key);
        await getPool().query(`SELECT public.kv_hset($1, $2::jsonb)`, [key, JSON.stringify(fields)]);
        return Object.keys(fields).length;
    },
    async hdel(key, ...fields) {
        if (!fields.length)
            return 0;
        _cacheInvalidate(key);
        await getPool().query(`SELECT public.kv_hdel($1, $2::text[])`, [key, fields]);
        return fields.length;
    },
};
// ─── Supabase REST backend (Vercel / serverless) ──────────────────────────────
const supabase_js_1 = require("@supabase/supabase-js");
let _supabase = null;
function _cleanDnsHost(value) {
    const host = (value ?? '').trim().toLowerCase();
    if (!host)
        return null;
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || !host.includes('.')) {
        throw new Error('[kv] SUPABASE_DNS_HOST must be a bare hostname such as project.supabase.co.');
    }
    return host;
}
function _cleanIpv4(value) {
    const ip = (value ?? '').trim();
    if (!ip)
        return null;
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
        throw new Error('[kv] SUPABASE_HARDCODED_IP must be a valid IPv4 address.');
    }
    return ip;
}
function _buildSupabaseDnsMap(env) {
    const explicitlyEnabled = env.SUPABASE_DNS_BYPASS === '1';
    const host = _cleanDnsHost(env.SUPABASE_DNS_HOST);
    const ip = _cleanIpv4(env.SUPABASE_HARDCODED_IP);
    if (!explicitlyEnabled && !host && !ip)
        return {};
    if (!host || !ip) {
        throw new Error('[kv] SUPABASE_DNS_BYPASS requires both SUPABASE_DNS_HOST and SUPABASE_HARDCODED_IP.');
    }
    return { [host]: ip };
}
function getSupabase() {
    if (_supabase)
        return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    // Optional cPanel-only DNS bypass. Configure BOTH SUPABASE_DNS_HOST and
    // SUPABASE_HARDCODED_IP when CageFS cannot resolve the Supabase hostname.
    // No project hostname or fallback IP is embedded here because Supabase's
    // Cloudflare address can rotate and is deployment-specific.
    const _DNS_MAP = _buildSupabaseDnsMap(process.env);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function _envDnsLookup(hostname, options, callback) {
        if (_DNS_MAP[hostname])
            return callback(null, _DNS_MAP[hostname], 4);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('dns').lookup(hostname, options, callback);
    }
    let baseFetch = globalThis.fetch;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const undici = require('undici');
        if (Object.keys(_DNS_MAP).length > 0) {
            const agent = new undici.Agent({ connect: { family: 4, lookup: _envDnsLookup } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            baseFetch = (input, init) => undici.fetch(input, { ...(init ?? {}), dispatcher: agent });
        }
    }
    catch {
        // undici not available — fall back to global fetch
    }
    // Give every Supabase REST call a 20-second hard timeout.
    const fetchWithTimeout = (input, init) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        return baseFetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };
    _supabase = (0, supabase_js_1.createClient)(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchWithTimeout },
    });
    return _supabase;
}
function isExpired(exp) {
    return !!exp && new Date(exp) <= new Date();
}
const supabaseKv = {
    async get(key) {
        const db = getSupabase();
        const { data, error } = await db.from('kv_store').select('value, expires_at').eq('key', key).maybeSingle();
        if (error)
            throw new Error(`kv.get(${key}): ${error.message}`);
        if (!data)
            return null;
        if (isExpired(data.expires_at)) {
            void db.from('kv_store').delete().eq('key', key);
            return null;
        }
        return data.value;
    },
    async set(key, value, options) {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { data, error } = await db.rpc('kv_set_nx', { p_key: key, p_value: value, p_expires_at: exp });
            if (error)
                throw new Error(`kv.set NX(${key}): ${error.message}`);
            return data ? 'OK' : null;
        }
        const { error } = await db.from('kv_store').upsert({ key, value, expires_at: exp, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (error)
            throw new Error(`kv.set(${key}): ${error.message}`);
        return 'OK';
    },
    async del(...keys) {
        if (!keys.length)
            return 0;
        const db = getSupabase();
        const { count, error } = await db.from('kv_store').delete({ count: 'exact' }).in('key', keys);
        if (error)
            throw new Error(`kv.del: ${error.message}`);
        return count ?? 0;
    },
    async incr(key, options) {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { data, error } = await db.rpc('kv_incr', { p_key: key, p_expires_at: exp });
        if (error)
            throw new Error(`kv.incr(${key}): ${error.message}`);
        return Number(data);
    },
    async keys(pattern) {
        const db = getSupabase();
        // Fetch key + expires_at and filter expiry client-side.
        // Avoid putting a timestamp inside .or() — the colons in ISO strings
        // confuse the PostgREST filter parser and cause consistent 500 errors.
        const { data, error } = await db
            .from('kv_store').select('key, expires_at')
            .like('key', toSqlPattern(pattern));
        if (error)
            throw new Error(`kv.keys(${pattern}): ${error.message}`);
        const now = Date.now();
        return (data ?? [])
            .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
            .map((r) => r.key);
    },
    async mget(...keys) {
        if (!keys.length)
            return [];
        const db = getSupabase();
        // Same pattern as keys(): fetch expires_at and filter client-side
        // to avoid the PostgREST timestamp colon parsing bug.
        const { data, error } = await db
            .from('kv_store').select('key, value, expires_at')
            .in('key', keys);
        if (error)
            throw new Error(`kv.mget: ${error.message}`);
        const now = Date.now();
        const map = new Map((data ?? [])
            .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
            .map((r) => [r.key, r.value]));
        return keys.map((k) => (map.has(k) ? map.get(k) : null));
    },
    async hgetall(key) {
        return supabaseKv.get(key);
    },
    async hkeys(key) {
        // REST backend has no keys-only projection — fall back to a full read.
        // Acceptable: the huge shared-image hashes route to the disk overlay,
        // never to this backend; base-store hashes are small.
        const all = await supabaseKv.hgetall(key);
        return all && typeof all === 'object' ? Object.keys(all) : [];
    },
    async hset(key, fields) {
        const db = getSupabase();
        const { error } = await db.rpc('kv_hset', { p_key: key, p_fields: fields });
        if (error) {
            console.warn(`kv.hset RPC failed, using fallback: ${error.message}`);
            const existing = (await supabaseKv.get(key)) ?? {};
            await supabaseKv.set(key, { ...existing, ...fields });
        }
        return Object.keys(fields).length;
    },
    async hdel(key, ...fields) {
        if (!fields.length)
            return 0;
        const db = getSupabase();
        const { error } = await db.rpc('kv_hdel', { p_key: key, p_fields: fields });
        if (error) {
            console.warn(`kv.hdel RPC failed, using fallback: ${error.message}`);
            const existing = (await supabaseKv.get(key)) ?? {};
            for (const f of fields)
                delete existing[f];
            await supabaseKv.set(key, existing);
        }
        return fields.length;
    },
};
// ─── Disk-backed KV (cPanel) + HTTP proxy KV (Vercel) ────────────────────────
//
// Heavy/large keys (player saves, uploaded images) live on cPanel disk to
// keep Supabase rows small and reduce REST traffic. Vercel reaches them
// through an HTTP proxy endpoint (/api/kv) on theravensark.com.
//
// Routing rule: a key matches DISK when its prefix is one of:
//   save:                 — player save blobs
//   shared:images*        — uploaded image blobs (incl. bloodline images)
//   shared:imgfields*     — uploaded image hash fields
//
// save-snapshot: is intentionally base-primary (Supabase/Postgres) so backup
// and live data do not share the disk/proxy failure domain.
// Live saves stay on the disk/proxy overlay; snapshots deliberately do NOT.
// Backups are written to the independent base database so losing the overlay
// cannot erase both the live save and its recovery copy. Legacy snapshots that
// already live on disk remain readable through the routing fallback below.
const _DISK_PREFIXES = ['save:', 'shared:images', 'shared:imgfields'];
const _SNAPSHOT_PREFIX = 'save-snapshot:';
function _routesToDisk(keyOrPattern) {
    return _DISK_PREFIXES.some((p) => keyOrPattern.startsWith(p));
}
function _routesToSnapshotBase(keyOrPattern) {
    return keyOrPattern.startsWith(_SNAPSHOT_PREFIX);
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _nodePath = require('node:path');
// Encode a colon-separated key as a filesystem path. Each segment is
// URL-encoded so weird characters can't escape the storage root.
//
// Defense-in-depth: encodeURIComponent does NOT encode `.`, so a key like
// `save:..:..:..:etc:passwd` would `join` to `<root>/save/../../../etc/passwd.json`
// and traverse out of the storage root. Two guards:
//   1. Reject any segment that is exactly `.` or `..` (the only segments
//      that have path-traversal meaning when joined).
//   2. After join, assert the resolved path is still under `root` — covers
//      any future filesystem oddity we didn't anticipate.
// A compromised KV_PROXY_TOKEN combined with this bug would otherwise be
// arbitrary disk read/write under the storage root's parent.
function _keyToPath(root, key) {
    const segs = key.split(':').map((s) => encodeURIComponent(s));
    for (const seg of segs) {
        if (seg === '.' || seg === '..') {
            throw new Error(`_keyToPath: refusing path-traversal segment in key "${key}"`);
        }
    }
    const joined = _nodePath.join(root, ...segs) + '.json';
    const resolvedRoot = _nodePath.resolve(root);
    const resolvedTarget = _nodePath.resolve(joined);
    // Allow exact root or any descendant; reject anything that escapes.
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + _nodePath.sep)) {
        throw new Error(`_keyToPath: resolved path escapes root for key "${key}"`);
    }
    return joined;
}
function _pathToKey(root, fullPath) {
    let rel = _nodePath.relative(root, fullPath);
    if (rel.endsWith('.json'))
        rel = rel.slice(0, -5);
    return rel.split(_nodePath.sep).map((s) => decodeURIComponent(s)).join(':');
}
async function _diskRead(root, key) {
    try {
        const txt = await _fs.promises.readFile(_keyToPath(root, key), 'utf8');
        return JSON.parse(txt);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    }
}
async function _diskWrite(root, key, rec) {
    const target = _keyToPath(root, key);
    await _fs.promises.mkdir(_nodePath.dirname(target), { recursive: true });
    const tmp = target + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await _fs.promises.writeFile(tmp, JSON.stringify(rec), 'utf8');
    await _fs.promises.rename(tmp, target);
}
async function _diskUnlink(root, key) {
    try {
        await _fs.promises.unlink(_keyToPath(root, key));
        return true;
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return false;
        throw e;
    }
}
// ─── Disk RMW serialization ───────────────────────────────────────────────────
//
// hset/hdel (and set-nx) on the disk overlay are read-modify-write over a
// single JSON file: read the whole hash, merge/delete fields, rewrite the file.
// Unserialized, concurrent writers interleave (both read the same snapshot,
// then the last write wins) and silently drop each other's fields — reproduced
// 2026-07-09 as image ids missing from the shared:imgfields:<cat> manifest
// after parallel POST /api/images publishes, while every image stayed
// individually servable via its own shared:img:<id> key (a plain set).
// api/images.ts's "HSET is atomic per-field" contract is enforced HERE.
// Two layers, both required:
//   1. An in-process promise chain, keyed module-wide by root+key — covers
//      concurrent requests inside one Node process, including across BOTH
//      _makeDiskKv instances (kv's _diskOverlay and the /api/kv proxy's
//      _diskKvForProxy share the same root).
//   2. A <keyfile>.lock file created with O_EXCL — covers concurrent
//      processes; Passenger may run several app processes on one DISK_KV_DIR.
// Plain set/del stay lock-free: whole-value writes are already atomic via
// _diskWrite's tmp+rename. Lock files never collide with data: _walkJson only
// picks *.json, and '<key>.json.lock' doesn't end in '.json'.
const _LOCK_STALE_MS = 10_000; // steal a lock older than this (crashed holder)
const _LOCK_WAIT_MS = 10_000; // then give up (throw) — caller surfaces a 500, client retries
async function _acquireDiskLock(lockPath) {
    const deadline = Date.now() + _LOCK_WAIT_MS;
    let delay = 15;
    for (;;) {
        try {
            await _fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
            return;
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
        const st = await _fs.promises.stat(lockPath).catch(() => null);
        if (st && Date.now() - st.mtimeMs > _LOCK_STALE_MS) {
            await _fs.promises.unlink(lockPath).catch(() => { }); // stale — steal it
            continue;
        }
        if (Date.now() >= deadline) {
            throw new Error(`disk kv: timed out waiting for lock ${lockPath}`);
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 200);
    }
}
const _diskRmwChains = new Map();
async function _withDiskKeyLock(root, key, fn) {
    const chainKey = JSON.stringify([root, key]); // unambiguous root/key boundary
    const prev = _diskRmwChains.get(chainKey) ?? Promise.resolve();
    const run = prev.then(async () => {
        const lockPath = _keyToPath(root, key) + '.lock';
        await _fs.promises.mkdir(_nodePath.dirname(lockPath), { recursive: true });
        await _acquireDiskLock(lockPath);
        try {
            return await fn();
        }
        finally {
            await _fs.promises.unlink(lockPath).catch(() => { });
        }
    });
    // Chain survives rejections (next op still runs); drop the map entry once idle.
    const tail = run.then(() => { }, () => { });
    _diskRmwChains.set(chainKey, tail);
    void tail.then(() => {
        if (_diskRmwChains.get(chainKey) === tail)
            _diskRmwChains.delete(chainKey);
    });
    return run;
}
async function _walkJson(dir, out) {
    let entries;
    try {
        entries = await _fs.promises.readdir(dir, { withFileTypes: true });
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return;
        throw e;
    }
    for (const e of entries) {
        const full = _nodePath.join(dir, e.name);
        if (e.isDirectory())
            await _walkJson(full, out);
        else if (e.isFile() && e.name.endsWith('.json') && !e.name.includes('.tmp-'))
            out.push(full);
    }
}
function _patternToRegex(pattern) {
    return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}
function _makeDiskKv(root) {
    return {
        async get(key) {
            const rec = await _diskRead(root, key);
            if (!rec)
                return null;
            if (isExpired(rec.expires_at)) {
                await _diskUnlink(root, key).catch(() => { });
                return null;
            }
            return rec.value;
        },
        async set(key, value, options) {
            const exp = options?.ex ? expiresAt(options.ex) : null;
            if (options?.nx) {
                // Check-then-write — serialize like the other RMW ops so two
                // concurrent nx claimers can't both observe "absent" and both win.
                return _withDiskKeyLock(root, key, async () => {
                    const existing = await _diskRead(root, key);
                    if (existing && !isExpired(existing.expires_at))
                        return null;
                    await _diskWrite(root, key, { value, expires_at: exp });
                    return 'OK';
                });
            }
            await _diskWrite(root, key, { value, expires_at: exp });
            return 'OK';
        },
        async del(...keys) {
            let n = 0;
            for (const k of keys)
                if (await _diskUnlink(root, k))
                    n++;
            return n;
        },
        // Non-atomic RMW. Disk-routed keys (save:/shared:) never use incr, so
        // this exists only to satisfy KvLike — the rate limiter's incr always
        // routes to the base Postgres/Supabase store (atomic kv_incr).
        async incr(key, options) {
            const cur = Number((await this.get(key)) ?? 0);
            const next = cur + 1;
            await this.set(key, next, options);
            return next;
        },
        async keys(pattern) {
            const files = [];
            await _walkJson(root, files);
            const re = _patternToRegex(pattern);
            const out = [];
            for (const f of files) {
                const k = _pathToKey(root, f);
                if (re.test(k))
                    out.push(k);
            }
            return out;
        },
        async mget(...keys) {
            const results = await Promise.all(keys.map((k) => this.get(k)));
            return results;
        },
        async hgetall(key) {
            return this.get(key);
        },
        async hkeys(key) {
            // Local disk read — fast even for big blobs; only the names leave.
            const all = await this.get(key);
            return all && typeof all === 'object' ? Object.keys(all) : [];
        },
        async hset(key, fields) {
            // Serialized RMW — see _withDiskKeyLock. Unserialized, concurrent
            // hsets read the same snapshot and the last write drops the other
            // writers' fields (lost image-manifest ids under parallel publishes).
            return _withDiskKeyLock(root, key, async () => {
                const existing = (await this.get(key)) ?? {};
                await this.set(key, { ...existing, ...fields });
                return Object.keys(fields).length;
            });
        },
        async hdel(key, ...fields) {
            if (!fields.length)
                return 0;
            return _withDiskKeyLock(root, key, async () => {
                const existing = (await this.get(key)) ?? {};
                for (const f of fields)
                    delete existing[f];
                await this.set(key, existing);
                return fields.length;
            });
        },
    };
}
// ─── Remote KV (HTTP client → cPanel proxy) ──────────────────────────────────
function _makeRemoteKv(baseUrl, token) {
    // Transport resilience. The proxy lives on the cPanel box, which is bounced
    // on every deploy (a hard worker exit) and can be OOM-killed by CloudLinux
    // under load — either drops an in-flight response as a Passenger 502
    // ("Incomplete response received from application"). Un-retried, that single
    // blip surfaced as a player-facing 500 on a save/clan read (the exact GET
    // /api/save/clan-* Sentry error). A short bounded retry on transient
    // failures (network error, request timeout, or 502/503/504) turns almost all
    // of them into a successful second attempt — the blip stays invisible.
    //
    // Idempotency: only safe-to-repeat ops are retried. Reads always are; plain
    // set/del/hset/hdel re-apply identically (same body; last-write-wins). The
    // one unsafe case opts OUT via { retryable: false } — a set with nx is a
    // check-then-write claim, so a lost 2xx response would make the retry see
    // its own prior claim and wrongly report "not claimed". (incr composes from
    // a retryable get + a retryable plain set below, which stays correct because
    // the recomputed value is deterministic given the same prior read.)
    const RETRY_STATUS = new Set([502, 503, 504]);
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 150; // linear backoff between tries: 150ms, 300ms
    const POINT_TIMEOUT_MS = 8_000; // abort a hung point op; bulk scans pass 0 (no timeout)
    async function call(op, body, opts) {
        const maxAttempts = opts?.retryable === false ? 1 : MAX_ATTEMPTS;
        const timeoutMs = opts?.timeoutMs ?? POINT_TIMEOUT_MS;
        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let transient = false;
            // Per-attempt timeout using the same AbortController idiom as the
            // Supabase fetchWithTimeout above. Skipped (no signal) when
            // timeoutMs <= 0 so a legitimately slow keys/mget scan over a big
            // cPanel keyspace is never aborted mid-walk.
            const ctrl = timeoutMs > 0 ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
            try {
                const r = await fetch(baseUrl.replace(/\/$/, '') + '/' + op, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-kv-token': token },
                    body: JSON.stringify(body),
                    signal: ctrl?.signal,
                });
                if (r.ok)
                    return (await r.json());
                lastErr = new Error(`remoteKv ${op}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
                transient = RETRY_STATUS.has(r.status);
            }
            catch (e) {
                // fetch threw: DNS/connection error, or the abort timeout fired
                // (AbortError). Both are transient — worth another attempt.
                lastErr = e;
                transient = true;
            }
            finally {
                if (timer)
                    clearTimeout(timer);
            }
            if (!transient || attempt >= maxAttempts)
                break;
            await new Promise((res) => setTimeout(res, RETRY_DELAY_MS * attempt));
        }
        throw lastErr;
    }
    return {
        async get(key) {
            return (await call('get', { key })).value;
        },
        async set(key, value, options) {
            // nx claims are check-then-write: not safe to retry (a lost 2xx would
            // make the retry observe the existing claim and report "not claimed").
            // Plain sets re-apply the same value — retryable.
            return (await call('set', { key, value, options }, { retryable: !options?.nx })).result;
        },
        async del(...keys) {
            return (await call('del', { keys })).count;
        },
        // Non-atomic RMW over the proxy. Never used for disk-routed keys (the
        // only keys that reach the remote overlay), so the rate limiter never
        // hits this path — see the routed incr below.
        async incr(key, options) {
            const cur = Number((await this.get(key)) ?? 0);
            const next = cur + 1;
            await this.set(key, next, options);
            return next;
        },
        async keys(pattern) {
            // Whole-keyspace walk on the cPanel disk — legitimately slow over a
            // large save keyspace, so no client abort timeout (timeoutMs: 0).
            // Still retried on transient transport failures.
            return (await call('keys', { pattern }, { timeoutMs: 0 })).keys;
        },
        async mget(...keys) {
            // Batched multi-key read — can be large (the snapshot cron mgets many
            // saves at once); no client abort timeout for the same reason as keys.
            return (await call('mget', { keys }, { timeoutMs: 0 })).values;
        },
        async hgetall(key) {
            return (await call('get', { key })).value;
        },
        async hkeys(key) {
            // Proxy-side key extraction — the whole point: the multi-MB image
            // hash stays on the cPanel box; only the id list crosses the wire.
            return (await call('hkeys', { key })).fields;
        },
        async hset(key, fields) {
            return (await call('hset', { key, fields })).count;
        },
        async hdel(key, ...fields) {
            return (await call('hdel', { key, fields })).count;
        },
    };
}
// ─── Routing wrapper ──────────────────────────────────────────────────────────
function _makeRoutedKv(base, disk) {
    function split(keys) {
        const diskKeys = [];
        const baseKeys = [];
        const order = [];
        for (const k of keys) {
            if (_routesToDisk(k)) {
                diskKeys.push(k);
                order.push('disk');
            }
            else {
                baseKeys.push(k);
                order.push('base');
            }
        }
        return { diskKeys, baseKeys, order };
    }
    // Disk is now the source of truth for disk-routed prefixes — migration is
    // complete (see /api/admin/migrate-kv). Reads go straight to the overlay.
    async function diskGet(key) {
        return disk.get(key);
    }
    async function snapshotGet(key) {
        const primary = await base.get(key);
        return primary === null ? disk.get(key) : primary;
    }
    return {
        async get(key) {
            if (_routesToSnapshotBase(key))
                return snapshotGet(key);
            return _routesToDisk(key) ? diskGet(key) : base.get(key);
        },
        async set(key, value, options) {
            return _routesToDisk(key) ? disk.set(key, value, options) : base.set(key, value, options);
        },
        async del(...keys) {
            const { diskKeys, baseKeys } = split(keys);
            const snapshotKeys = keys.filter(_routesToSnapshotBase);
            // For disk-routed keys, also delete the legacy copy on base.
            // Snapshot keys are base-primary but also delete any legacy disk
            // copy so an expired/deleted backup cannot reappear via fallback.
            const [a, b, c, d] = await Promise.all([
                diskKeys.length ? disk.del(...diskKeys) : Promise.resolve(0),
                baseKeys.length ? base.del(...baseKeys) : Promise.resolve(0),
                diskKeys.length ? base.del(...diskKeys).catch(() => 0) : Promise.resolve(0),
                snapshotKeys.length ? disk.del(...snapshotKeys).catch(() => 0) : Promise.resolve(0),
            ]);
            return a + b + c + d;
        },
        async incr(key, options) {
            return _routesToDisk(key) ? disk.incr(key, options) : base.incr(key, options);
        },
        async keys(pattern) {
            if (_routesToSnapshotBase(pattern)) {
                const [primary, legacy] = await Promise.all([
                    base.keys(pattern),
                    disk.keys(pattern).catch(() => []),
                ]);
                return [...new Set([...primary, ...legacy])];
            }
            return _routesToDisk(pattern) ? disk.keys(pattern) : base.keys(pattern);
        },
        async mget(...keys) {
            // Batch per backend so the remote (Vercel) disk overlay does ONE
            // round-trip for all disk-routed keys instead of one HTTP call per
            // key. Migration is complete, so disk reads no longer need a per-key
            // fallback path (see diskGet above). Results are re-interleaved into
            // the caller's original key order — byte-identical to the per-key
            // path, just fewer network calls.
            const { diskKeys, baseKeys, order } = split(keys);
            const [diskVals, baseVals] = await Promise.all([
                diskKeys.length ? disk.mget(...diskKeys) : Promise.resolve([]),
                baseKeys.length ? base.mget(...baseKeys) : Promise.resolve([]),
            ]);
            const out = [];
            let di = 0, bi = 0;
            for (const src of order)
                out.push(src === 'disk' ? diskVals[di++] : baseVals[bi++]);
            const fallbackIndexes = keys
                .map((key, index) => ({ key, index }))
                .filter(({ key, index }) => _routesToSnapshotBase(key) && out[index] === null);
            if (fallbackIndexes.length) {
                const legacy = await disk.mget(...fallbackIndexes.map(({ key }) => key));
                fallbackIndexes.forEach(({ index }, i) => { out[index] = legacy[i]; });
            }
            return out;
        },
        async hgetall(key) {
            if (_routesToSnapshotBase(key))
                return snapshotGet(key);
            return _routesToDisk(key) ? diskGet(key) : base.hgetall(key);
        },
        async hkeys(key) {
            return _routesToDisk(key) ? disk.hkeys(key) : base.hkeys(key);
        },
        async hset(key, fields) {
            return _routesToDisk(key) ? disk.hset(key, fields) : base.hset(key, fields);
        },
        async hdel(key, ...fields) {
            return _routesToDisk(key) ? disk.hdel(key, ...fields) : base.hdel(key, ...fields);
        },
    };
}
function migrationValueEqual(a, b) {
    // KV values are JSON-compatible. A conservative false negative is safe: it
    // reports a conflict and retains both copies instead of deleting anything.
    return JSON.stringify(a) === JSON.stringify(b);
}
/**
 * Conflict-safe migration core with injectable stores for race tests.
 * Destination writes are NX, then read back and compared. The source is read a
 * second time before deletion. A newer/different overlay value is NEVER
 * replaced, and any source mutation leaves the source intact for operator
 * review. Callers must freeze legacy base writers during a live migration.
 */
async function _migrateDiskRoutedKeys(base, overlay, prefixes, opts) {
    const migrated = [];
    const alreadyPresent = [];
    const conflicts = [];
    const skipped = [];
    let deleted = 0;
    for (const prefix of prefixes) {
        const ks = await base.keys(prefix + '*');
        for (const k of ks) {
            const source = await base.get(k);
            if (source === null || source === undefined) {
                skipped.push(k);
                continue;
            }
            const destination = await overlay.get(k);
            if (destination !== null && destination !== undefined) {
                if (!migrationValueEqual(source, destination)) {
                    conflicts.push(k);
                    continue;
                }
                if (!opts?.dryRun) {
                    const sourceReadBack = await base.get(k);
                    if (!migrationValueEqual(source, sourceReadBack)) {
                        conflicts.push(k);
                        continue;
                    }
                    deleted += await base.del(k).catch(() => 0);
                }
                alreadyPresent.push(k);
                continue;
            }
            if (opts?.dryRun) {
                migrated.push(k);
                continue;
            }
            // NX closes the check->write race with a concurrent overlay writer.
            const claimed = await overlay.set(k, source, { nx: true });
            const readBack = await overlay.get(k);
            if (!claimed || !migrationValueEqual(source, readBack)) {
                conflicts.push(k);
                continue;
            }
            // A concurrent source change must never be deleted as if it were the
            // older value we copied. The endpoint additionally requires an
            // explicit write-freeze acknowledgement for live runs.
            const sourceReadBack = await base.get(k);
            if (!migrationValueEqual(source, sourceReadBack)) {
                conflicts.push(k);
                continue;
            }
            migrated.push(k);
            const n = await base.del(k).catch(() => 0);
            deleted += n;
        }
    }
    return { migrated, alreadyPresent, conflicts, skipped, deleted };
}
// One-shot migration helper. Snapshots are intentionally excluded: they now
// stay on the independent base store as disaster-recovery copies.
async function migrateDiskRoutedKeysToOverlay(opts) {
    if (!_diskOverlay)
        throw new Error('No disk overlay configured (set DISK_KV_DIR or KV_PROXY_URL).');
    return _migrateDiskRoutedKeys(_baseKv, _diskOverlay, _DISK_PREFIXES, opts);
}
// ─── Export the right backend ─────────────────────────────────────────────────
//
// Layer 1 — pick the base backend (Supabase / Postgres):
//   pgKv          if DATABASE_URL / SUPABASE_POSTGRES_URL is set
//   supabaseKv    otherwise
//
// Layer 2 — if disk storage is configured, route disk-prefix keys to it:
//   DISK_KV_DIR set  → disk-prefix keys go to local files
//   KV_PROXY_URL set → disk-prefix keys go to remote proxy (theravensark.com)
//   neither set      → all keys stay on the base backend (legacy behavior)
// On Vercel, always use the Supabase REST API regardless of which Postgres
// env vars are present. The Supabase Vercel integration auto-sets a pile of
// SUPABASE_POSTGRES_* vars that may not work from Vercel's network anyway,
// and the disk overlay already handles the heavy storage. Set FORCE_PG_KV=1
// to override and force the pg pool path.
const _onVercel = !!process.env.VERCEL;
const _forcePg = process.env.FORCE_PG_KV === '1';
const _havePgUrl = !!(process.env.DATABASE_URL || process.env.SUPABASE_POSTGRES_URL);
const _baseKv = (_forcePg || (_havePgUrl && !_onVercel)) ? pgKv : supabaseKv;
// Disk overlay (only attached when env tells us where to read/write).
const _diskRoot = process.env.DISK_KV_DIR ?? null;
const _proxyUrl = process.env.KV_PROXY_URL ?? null;
const _proxyToken = process.env.KV_PROXY_TOKEN ?? null;
let _diskOverlay = null;
if (_diskRoot) {
    _diskOverlay = _makeDiskKv(_diskRoot);
    console.log('[kv] disk overlay active at', _diskRoot);
}
else if (_proxyUrl && _proxyToken) {
    _diskOverlay = _makeRemoteKv(_proxyUrl, _proxyToken);
    console.log('[kv] remote proxy overlay active at', _proxyUrl);
}
// Fail-closed guard. On Railway/cPanel the live player saves (`save:*`) live on
// the disk overlay; if its env (DISK_KV_DIR, or KV_PROXY_URL + KV_PROXY_TOKEN)
// is missing on a deploy, save reads/writes SILENTLY fall back to the base store
// — which doesn't have them — so every player looks logged-out / wiped and new
// progress is written to the wrong place. When an operator declares the overlay
// mandatory via REQUIRE_DISK_OVERLAY=1, refuse to boot instead (health check
// fails loudly) rather than serving/clobbering saves from the base store. Opt-in
// so legacy single-tier setups are unaffected.
if (process.env.REQUIRE_DISK_OVERLAY === '1' && !_diskOverlay) {
    throw new Error('[kv] REQUIRE_DISK_OVERLAY=1 but no disk overlay is configured ' +
        '(set DISK_KV_DIR, or KV_PROXY_URL + KV_PROXY_TOKEN). Refusing to serve ' +
        'save:* from the base store.');
}
exports.kv = _diskOverlay ? _makeRoutedKv(_baseKv, _diskOverlay) : _baseKv;
// Which backend the disk-routed `save:*` keys actually resolve to. Surfaced by
// the /health?deep=1 probe so an operator can instantly catch a misconfigured
// deploy that silently routes saves to the (empty) base store instead of the
// disk overlay — the exact failure REQUIRE_DISK_OVERLAY guards against. A value
// of 'base-store' on a host that serves /api/save/* means saves are misrouted.
exports.saveStoreKind = _diskRoot ? 'disk' : ((_proxyUrl && _proxyToken) ? 'remote-proxy' : 'base-store');
// Expose the disk backend directly for the /api/kv proxy endpoint to use.
exports._diskKvForProxy = _diskRoot ? _makeDiskKv(_diskRoot) : null;
