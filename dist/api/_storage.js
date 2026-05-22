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
exports._diskKvForProxy = exports.kv = void 0;
exports.migrateDiskRoutedKeysToOverlay = migrateDiskRoutedKeysToOverlay;
const _readCache = new Map();
// These prefixes change too rapidly to benefit from caching.
const _noCachePrefixes = ['presence:', 'challenges:', 'reset-signal:', 'admin-lock:'];
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
        ssl: { rejectUnauthorized: false },
        max: 5,
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
function getSupabase() {
    if (_supabase)
        return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    // Build a base fetch that hardcodes the Supabase IPv4 address.
    // CloudLinux CageFS jails block outbound DNS (port 53), so getaddrinfo
    // always fails. We bypass DNS entirely by hardcoding the known IPv4 address
    // (Cloudflare CDN) and passing a custom lookup to the undici Agent.
    // Resolved externally: nslookup soaychxshtbgwujhytsf.supabase.co 8.8.8.8
    const _HARDCODED_IPS = {
        'soaychxshtbgwujhytsf.supabase.co': '172.64.149.246',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function _hardcodedLookup(hostname, options, callback) {
        if (_HARDCODED_IPS[hostname])
            return callback(null, _HARDCODED_IPS[hostname], 4);
        // Fallback: any *.supabase.co host hits the same Cloudflare CDN —
        // CageFS blocks DNS so dns.lookup would fail anyway.
        if (hostname.endsWith('.supabase.co'))
            return callback(null, '172.64.149.246', 4);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('dns').lookup(hostname, options, callback);
    }
    let baseFetch = globalThis.fetch;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const undici = require('undici');
        const agent = new undici.Agent({ connect: { family: 4, lookup: _hardcodedLookup } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        baseFetch = (input, init) => undici.fetch(input, { ...(init ?? {}), dispatcher: agent });
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
// All other keys keep using pgKv / supabaseKv as before.
const _DISK_PREFIXES = ['save:', 'shared:images', 'shared:imgfields'];
function _routesToDisk(keyOrPattern) {
    return _DISK_PREFIXES.some((p) => keyOrPattern.startsWith(p));
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _nodePath = require('node:path');
// Encode a colon-separated key as a filesystem path. Each segment is
// URL-encoded so weird characters can't escape the storage root.
function _keyToPath(root, key) {
    const segs = key.split(':').map((s) => encodeURIComponent(s));
    return _nodePath.join(root, ...segs) + '.json';
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
            if (options?.nx) {
                const existing = await _diskRead(root, key);
                if (existing && !isExpired(existing.expires_at))
                    return null;
            }
            const exp = options?.ex ? expiresAt(options.ex) : null;
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
        async hset(key, fields) {
            const existing = (await this.get(key)) ?? {};
            await this.set(key, { ...existing, ...fields });
            return Object.keys(fields).length;
        },
        async hdel(key, ...fields) {
            if (!fields.length)
                return 0;
            const existing = (await this.get(key)) ?? {};
            for (const f of fields)
                delete existing[f];
            await this.set(key, existing);
            return fields.length;
        },
    };
}
// ─── Remote KV (HTTP client → cPanel proxy) ──────────────────────────────────
function _makeRemoteKv(baseUrl, token) {
    async function call(op, body) {
        const r = await fetch(baseUrl.replace(/\/$/, '') + '/' + op, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-kv-token': token },
            body: JSON.stringify(body),
        });
        if (!r.ok)
            throw new Error(`remoteKv ${op}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
        return (await r.json());
    }
    return {
        async get(key) {
            return (await call('get', { key })).value;
        },
        async set(key, value, options) {
            return (await call('set', { key, value, options })).result;
        },
        async del(...keys) {
            return (await call('del', { keys })).count;
        },
        async keys(pattern) {
            return (await call('keys', { pattern })).keys;
        },
        async mget(...keys) {
            return (await call('mget', { keys })).values;
        },
        async hgetall(key) {
            return (await call('get', { key })).value;
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
    // Read-through fallback: when a disk-routed key isn't on disk yet, look it
    // up on the base backend (Supabase) — that's where it lived before we
    // flipped on disk storage. Lets existing data keep working during the
    // gradual migration.
    async function getWithFallback(key) {
        const v = await disk.get(key);
        if (v !== null)
            return v;
        return base.get(key);
    }
    return {
        async get(key) {
            return _routesToDisk(key) ? getWithFallback(key) : base.get(key);
        },
        async set(key, value, options) {
            return _routesToDisk(key) ? disk.set(key, value, options) : base.set(key, value, options);
        },
        async del(...keys) {
            const { diskKeys, baseKeys } = split(keys);
            // For disk-routed keys, also delete the legacy copy on base.
            const [a, b, c] = await Promise.all([
                diskKeys.length ? disk.del(...diskKeys) : Promise.resolve(0),
                baseKeys.length ? base.del(...baseKeys) : Promise.resolve(0),
                diskKeys.length ? base.del(...diskKeys).catch(() => 0) : Promise.resolve(0),
            ]);
            return a + b + c;
        },
        async keys(pattern) {
            // Disk-routed pattern: union disk + base so legacy keys stay visible.
            if (_routesToDisk(pattern)) {
                const [a, b] = await Promise.all([disk.keys(pattern), base.keys(pattern)]);
                return Array.from(new Set([...a, ...b]));
            }
            return base.keys(pattern);
        },
        async mget(...keys) {
            // Use the per-key get path so disk-routed keys benefit from fallback.
            return Promise.all(keys.map((k) => _routesToDisk(k) ? getWithFallback(k) : base.get(k)));
        },
        async hgetall(key) {
            return _routesToDisk(key) ? getWithFallback(key) : base.hgetall(key);
        },
        async hset(key, fields) {
            return _routesToDisk(key) ? disk.hset(key, fields) : base.hset(key, fields);
        },
        async hdel(key, ...fields) {
            return _routesToDisk(key) ? disk.hdel(key, ...fields) : base.hdel(key, ...fields);
        },
    };
}
// One-shot migration helper. Walks all disk-routed keys on the base backend,
// copies each to the disk backend, then deletes the base copy. Idempotent.
// Exposed via /api/admin/migrate-kv (admin-auth required).
async function migrateDiskRoutedKeysToOverlay(opts) {
    if (!_diskOverlay)
        throw new Error('No disk overlay configured (set DISK_KV_DIR or KV_PROXY_URL).');
    const migrated = [];
    const skipped = [];
    let deleted = 0;
    for (const prefix of _DISK_PREFIXES) {
        const ks = await _baseKv.keys(prefix + '*');
        for (const k of ks) {
            const v = await _baseKv.get(k);
            if (v === null || v === undefined) {
                skipped.push(k);
                continue;
            }
            if (opts?.dryRun) {
                migrated.push(k);
                continue;
            }
            await _diskOverlay.set(k, v);
            migrated.push(k);
            const n = await _baseKv.del(k).catch(() => 0);
            deleted += n;
        }
    }
    return { migrated, skipped, deleted };
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
const _baseKv = (process.env.DATABASE_URL || process.env.SUPABASE_POSTGRES_URL) ? pgKv : supabaseKv;
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
exports.kv = _diskOverlay ? _makeRoutedKv(_baseKv, _diskOverlay) : _baseKv;
// Expose the disk backend directly for the /api/kv proxy endpoint to use.
exports._diskKvForProxy = _diskRoot ? _makeDiskKv(_diskRoot) : null;
