/**
 * Dual-mode KV adapter — drop-in replacement for @vercel/kv.
 * Railway is the active runtime; cPanel/Passenger and Vercel references below
 * describe retained compatibility, migration, or rollback behavior only.
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

// ─── In-process read cache ────────────────────────────────────────────────────
// On cPanel / Passenger the Node process is long-lived, so this Map survives
// across requests and acts as a free first-level cache that absorbs repeated
// reads (world-state, images, etc.) without touching Postgres at all.
// On Vercel (stateless) instances are short-lived so this is a best-effort
// bonus; CDN Cache-Control headers are the primary caching layer there.

interface CacheEntry { value: unknown; expiresAt: number; }
const _readCache = new Map<string, CacheEntry>();

// Hard ceiling on distinct cached keys. On Railway the process is long-lived, so
// without a cap the Map grows for the life of the process — one entry per distinct
// key ever read (every `save:<player>`, `img-owner:<id>`, etc.), and expired
// entries are only reclaimed if that *same* key is read again. A key written once
// and never re-read would leak forever. We bound it as an LRU: Map preserves
// insertion order, so the oldest (least-recently-used) key is always the first one
// the iterator yields, and re-inserting on access moves an entry to the newest slot.
const _CACHE_MAX_ENTRIES = 5000;

// These prefixes change too rapidly to benefit from caching.
const _noCachePrefixes = [
    // Saves are mutable economy ledgers. Distributed save locks coordinate
    // writers across processes, but a worker-local cached read inside the lock
    // can still overwrite a prior worker's committed receipt or unrelated
    // character field. Every lock holder must therefore read the backing store.
    'save:',
    'presence:',
    'challenges:',
    'challenge-outgoing:',
    'challenge-terminal:',
    'arena-challenge-setup:',
    // Co-op lobbies and accepted Arena-match recovery records are shared,
    // mutable coordination state. A worker-local cached snapshot can otherwise
    // overwrite a newer join/start or hide a terminal reveal from another
    // worker even while both writers correctly hold the distributed lock.
    'arena:lobby:',
    'arena-match-recovery:',
    // Battle Towers sessions, parties, invites, and battle leases are mutated
    // behind distributed locks. A lock holder must still bypass its worker-local
    // L1 so it cannot overwrite a newer turn/roster/lease committed elsewhere.
    'tower:',
    'tower-party:',
    'tower-party-code:',
    'tower-party-player:',
    'tower-party-invites:',
    'tower-invite:',
    'battle-lock:',
    'tower-engine-clan-boss:',
    // Mission progress, active-combat pointers, Clan Boss parties, and the
    // Weekly Boss aggregate all use lock/CAS based cross-worker mutation. Cache
    // hits inside those critical sections would turn a valid lock holder into
    // a stale writer or make lost-ack recovery inspect an obsolete value.
    'missions:',
    'mission-combat-',
    'clan-boss:',
    'game:weekly-boss-state',
    // Live combat and settlement sagas must read their backing authority on
    // every worker. Local writes already invalidate only this process's L1;
    // these prefixes close the corresponding cross-process stale-read window.
    'solo-pve:',
    'ai-fight-',
    'pet:battle-active:',
    'pet:ranked-',
    // Reward-bearing progression and combat bindings.
    'hg-',
    'endless-wave-',
    'story:',
    'story-combat-binding:',
    'legacy:',
    'era:',
    'game:era-state',
    // War, Kage, clan, and treasury authority. These rows combine permissions
    // with plain locked RMW, so even a brief stale read is unsafe.
    'world:territory:',
    'world:war:',
    'shared:sector-war',
    'shared:village-war:',
    'game:village-state:',
    'village:kage:',
    'village:war-standing:',
    'clan-war:',
    'clan-war-pet:',
    'cw-tilecards:',
    'clan-seal-pool:',
    'clan-mentor',
    // Permanent pet storage, daily mint caps, live card sessions, and ranked
    // ladders likewise require cross-worker backing-store truth.
    'pet-sanctuary:',
    'training-start-count:',
    'card-clash:',
    'cc-',
    'petladder:',
    'petgauntlet:lb:',
    'sector-card:',
    'sector-pet:',
    'infil:',
    'infil-active:',
    // PvP sessions and settlement journals are cross-worker live authority.
    // The broad prefix also covers bounty and Vanguard fences introduced by
    // the cohesion hardening, so every owner/help-forward check reaches the
    // backing store rather than a process-local null or stale owner.
    'pvp:',
    'reset-signal:',
    'admin-lock:',
    'auth:',
    'auth-session:',
    'world:travel-lease:',
    // Security-sensitive Warfront grants, active leases, decision paths, and
    // one-use battle tokens must always observe the backing store. A stale
    // process-local read can otherwise reopen or fork an authorization.
    'pet:warfront-prepared:',
    'pet:warfront-active:',
    'pet:warfront-authorization:',
    'pet:warfront-council:',
    'pet:battle-token:',
];

export function _shouldCache(key: string): boolean {
    return !_noCachePrefixes.some(p => key.startsWith(p));
}

function _cacheTtlMs(key: string): number {
    if (key.startsWith('shared:images') || key.startsWith('shared:imgfields')) return 60_000;
    if (key.startsWith('world:') || key.startsWith('game:')) return 15_000;
    return 10_000; // saves, auth, registry, etc.
}

function _cacheRead<T>(key: string): T | undefined {
    if (!_shouldCache(key)) return undefined;
    const entry = _readCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { _readCache.delete(key); return undefined; }
    // Mark as most-recently-used so a hot key is never the first eviction target.
    _readCache.delete(key);
    _readCache.set(key, entry);
    return entry.value as T;
}

function _cacheWrite(key: string, value: unknown): void {
    if (!_shouldCache(key)) return;
    // Delete-then-set moves an existing key to the newest LRU slot.
    _readCache.delete(key);
    _readCache.set(key, { value, expiresAt: Date.now() + _cacheTtlMs(key) });
    // Evict the least-recently-used entries once over the ceiling. The oldest key is
    // the first one the iterator yields; deleting it is O(1). Old expired entries sit
    // near the front, so they get reclaimed first in the natural course of eviction.
    while (_readCache.size > _CACHE_MAX_ENTRIES) {
        const oldest = _readCache.keys().next().value;
        if (oldest === undefined) break;
        _readCache.delete(oldest);
    }
}

function _cacheInvalidate(...keys: string[]): void {
    for (const k of keys) _readCache.delete(k);
}

// ─── pg Pool backend (cPanel / Passenger) ────────────────────────────────────

import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export async function closeStoragePool(): Promise<void> {
    const pool = _pool;
    _pool = null;
    if (pool) await pool.end();
}

function getPool(): pg.Pool {
    if (_pool) return _pool;

    // DATABASE_URL wins; fall back to SUPABASE_POSTGRES_URL (set automatically
    // by the Supabase Vercel integration on all environments).
    const url = (process.env.DATABASE_URL ?? process.env.SUPABASE_POSTGRES_URL)!;

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
        // processes, so 5 each is plenty there. The single always-on Railway
        // instance serves EVERY player's heartbeat/save traffic through this one
        // pool, so it defaults to 15 (Railway is detected via the platform's own
        // RAILWAY_ENVIRONMENT var); with only 5 connections a small burst of slow
        // statements starves the pool and everything else waits on the 15s
        // acquire timeout. PG_POOL_MAX overrides either default explicitly, and
        // a (dormant) cPanel host booting N Passenger workers stays at 5 so it
        // can't multiply into the Supabase connection ceiling.
        max: Number(process.env.PG_POOL_MAX ?? (process.env.RAILWAY_ENVIRONMENT ? 15 : 5)),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
        // Bound a pathologically slow query so it can't pin a pool connection
        // indefinitely (there was no query timeout before — a hung statement held
        // its connection until the server role's 2-min default, and with only a
        // handful of connections a few of those starve the whole pool and
        // everything else 15s-times-out waiting to acquire). Base-store queries
        // are PK/indexed lookups or small batched reads; since the cPanel disk
        // overlay was retired (2026-07-17) the multi-MB save/image blobs also
        // travel this pool, and 30s remains far above any legitimate statement —
        // this only ever fires on a genuine hang.
        // statement_timeout is server-enforced; query_timeout is the client-side
        // backstop if the socket itself wedges. Overridable via PG_STATEMENT_TIMEOUT_MS.
        statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30_000),
        query_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30_000),
    });

    _pool.on('error', (err) => {
        console.error('[pg pool error]', err.message);
    });

    return _pool;
}

export function _toSqlPattern(pattern: string): string {
    return pattern
        // PostgreSQL LIKE treats backslash as its default escape character.
        // Escape it first so a caller cannot use `\%` / `\_` to undo the
        // literal escaping below.
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/\*/g, '%')
        .replace(/\?/g, '_');
}

function expiresAt(ex: number): string {
    return new Date(Date.now() + ex * 1000).toISOString();
}

// ─── pg implementations ───────────────────────────────────────────────────────

const pgKv = {
    async get<T = unknown>(key: string): Promise<T | null> {
        const hit = _cacheRead<T>(key);
        if (hit !== undefined) return hit;
        const db = getPool();
        const { rows } = await db.query<{ value: unknown; expires_at: string | null }>(
            `SELECT value, expires_at FROM public.kv_store WHERE key = $1`,
            [key]
        );
        if (!rows.length) { _cacheWrite(key, null); return null; }
        const row = rows[0];
        if (row.expires_at && new Date(row.expires_at) <= new Date()) {
            void db.query(`DELETE FROM public.kv_store WHERE key = $1`, [key]);
            return null;
        }
        _cacheWrite(key, row.value);
        return row.value as T;
    },

    async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
        _cacheInvalidate(key);
        const db = getPool();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { rows } = await db.query<{ kv_set_nx: boolean }>(
                `SELECT public.kv_set_nx($1, $2::jsonb, $3::timestamptz) AS kv_set_nx`,
                [key, JSON.stringify(value), exp]
            );
            if (rows[0].kv_set_nx) _cacheWrite(key, value);
            return rows[0].kv_set_nx ? 'OK' : null;
        }
        await db.query(
            `INSERT INTO public.kv_store (key, value, expires_at, updated_at)
             VALUES ($1, $2::jsonb, $3::timestamptz, now())
             ON CONFLICT (key) DO UPDATE
                 SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`,
            [key, JSON.stringify(value), exp]
        );
        _cacheWrite(key, value);
        return 'OK';
    },

    async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }): Promise<boolean> {
        _cacheInvalidate(key);
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const db = getPool();
        let swapped: boolean;
        if (expected === null) {
            // One statement handles both allowed absence cases. A conflicting
            // LIVE row makes the ON CONFLICT WHERE false and changes nothing;
            // an expired row is atomically replaced while PostgreSQL holds the
            // conflicting row lock. This avoids requiring a separately-applied
            // schema RPC on Railway without weakening CAS into get-then-set.
            const { rows } = await db.query<{ swapped: boolean }>(
                `INSERT INTO public.kv_store AS current (key, value, expires_at, updated_at)
                 VALUES ($1, $2::jsonb, $3::timestamptz, now())
                 ON CONFLICT (key) DO UPDATE
                     SET value = EXCLUDED.value,
                         expires_at = EXCLUDED.expires_at,
                         updated_at = now()
                     WHERE current.expires_at IS NOT NULL
                       AND current.expires_at <= now()
                 RETURNING true AS swapped`,
                [key, JSON.stringify(value), exp],
            );
            swapped = rows[0]?.swapped === true;
        } else {
            // Exact full-JSON predecessor match and liveness check happen in the
            // UPDATE itself. A mismatch/expired row returns no row and preserves
            // both its value and TTL. On success, even a null expiry is written,
            // so the replacement TTL is authoritative just like set().
            const { rows } = await db.query<{ swapped: boolean }>(
                `UPDATE public.kv_store
                 SET value = $3::jsonb,
                     expires_at = $4::timestamptz,
                     updated_at = now()
                 WHERE key = $1
                   AND value = $2::jsonb
                   AND (expires_at IS NULL OR expires_at > now())
                 RETURNING true AS swapped`,
                [key, JSON.stringify(expected), JSON.stringify(value), exp],
            );
            swapped = rows[0]?.swapped === true;
        }
        if (swapped) _cacheWrite(key, value);
        return swapped;
    },

    async del(...keys: string[]): Promise<number> {
        if (!keys.length) return 0;
        _cacheInvalidate(...keys);
        const { rowCount } = await getPool().query(
            `DELETE FROM public.kv_store WHERE key = ANY($1::text[])`, [keys]
        );
        return rowCount ?? 0;
    },

    async delIfEqual(key: string, expected: string): Promise<boolean> {
        _cacheInvalidate(key);
        // Single atomic statement — the value comparison and the delete happen in
        // one row-locked operation, so no other writer can slip a new lock in
        // between. The lock value is stored as a JSONB string, so compare against
        // the JSON-encoded token.
        const { rowCount } = await getPool().query(
            `DELETE FROM public.kv_store WHERE key = $1 AND value = $2::jsonb`,
            [key, JSON.stringify(expected)]
        );
        return (rowCount ?? 0) > 0;
    },

    async incr(key: string, options?: { ex?: number }): Promise<number> {
        _cacheInvalidate(key);
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { rows } = await getPool().query<{ kv_incr: string }>(
            `SELECT public.kv_incr($1, $2::timestamptz) AS kv_incr`,
            [key, exp]
        );
        return Number(rows[0].kv_incr);
    },

    async keys(pattern: string): Promise<string[]> {
        const { rows } = await getPool().query<{ key: string }>(
            `SELECT key FROM public.kv_store WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > now())`,
            [_toSqlPattern(pattern)]
        );
        return rows.map((r) => r.key);
    },

    async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
        if (!keys.length) return [];
        // Check cache first — only fetch keys not already cached.
        const result: (T[number] | null)[] = new Array(keys.length).fill(null);
        const missIndices: number[] = [];
        const missKeys: string[] = [];
        for (let i = 0; i < keys.length; i++) {
            const hit = _cacheRead<T[number]>(keys[i]);
            if (hit !== undefined) { result[i] = hit; }
            else { missIndices.push(i); missKeys.push(keys[i]); }
        }
        if (missKeys.length) {
            const { rows } = await getPool().query<{ key: string; value: unknown }>(
                `SELECT key, value FROM public.kv_store WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > now())`,
                [missKeys]
            );
            const map = new Map(rows.map((r) => [r.key, r.value]));
            for (let j = 0; j < missKeys.length; j++) {
                const val = map.has(missKeys[j]) ? (map.get(missKeys[j]) as T[number]) : null;
                result[missIndices[j]] = val;
                _cacheWrite(missKeys[j], val);
            }
        }
        return result;
    },

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        return pgKv.get<T>(key);
    },

    async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
        // Image manifests opt into a value predicate so legacy empty-string
        // tombstones never become broken image URLs. Ordinary hash callers keep
        // normal Redis-style hkeys semantics.
        if (options?.nonEmptyStrings) {
            const { rows } = await getPool().query<{ k: string }>(
                `SELECT field.key AS k FROM public.kv_store
                 CROSS JOIN LATERAL jsonb_each(
                     CASE WHEN jsonb_typeof(kv_store.value) = 'object' THEN kv_store.value ELSE '{}'::jsonb END
                 ) AS field(key, value)
                 WHERE kv_store.key = $1 AND (expires_at IS NULL OR expires_at > now())
                   AND jsonb_typeof(kv_store.value) = 'object'
                   AND jsonb_typeof(field.value) = 'string'
                   AND field.value <> '""'::jsonb`,
                [key],
            );
            return rows.map((r) => r.k);
        }
        // Extract field names IN SQL — never ships the (multi-MB) value itself.
        // jsonb_object_keys errors on non-objects, so guard on jsonb_typeof.
        const { rows } = await getPool().query<{ k: string }>(
            `SELECT jsonb_object_keys(value) AS k FROM public.kv_store
             WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())
               AND jsonb_typeof(value) = 'object'`,
            [key],
        );
        return rows.map((r) => r.k);
    },

    async hset(key: string, fields: Record<string, unknown>): Promise<number> {
        _cacheInvalidate(key);
        await getPool().query(`SELECT public.kv_hset($1, $2::jsonb)`, [key, JSON.stringify(fields)]);
        return Object.keys(fields).length;
    },

    async hdel(key: string, ...fields: string[]): Promise<number> {
        if (!fields.length) return 0;
        _cacheInvalidate(key);
        await getPool().query(`SELECT public.kv_hdel($1, $2::text[])`, [key, fields]);
        return fields.length;
    },
};

// ─── Supabase REST backend (Vercel / serverless) ──────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function _cleanDnsHost(value: string | undefined): string | null {
    const host = (value ?? '').trim().toLowerCase();
    if (!host) return null;
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || !host.includes('.')) {
        throw new Error('[kv] SUPABASE_DNS_HOST must be a bare hostname such as project.supabase.co.');
    }
    return host;
}

function _cleanIpv4(value: string | undefined): string | null {
    const ip = (value ?? '').trim();
    if (!ip) return null;
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
        throw new Error('[kv] SUPABASE_HARDCODED_IP must be a valid IPv4 address.');
    }
    return ip;
}

function _buildSupabaseDnsMap(env: NodeJS.ProcessEnv): Record<string, string> {
    const explicitlyEnabled = env.SUPABASE_DNS_BYPASS === '1';
    const host = _cleanDnsHost(env.SUPABASE_DNS_HOST);
    const ip = _cleanIpv4(env.SUPABASE_HARDCODED_IP);
    if (!explicitlyEnabled && !host && !ip) return {};
    if (!host || !ip) {
        throw new Error('[kv] SUPABASE_DNS_BYPASS requires both SUPABASE_DNS_HOST and SUPABASE_HARDCODED_IP.');
    }
    return { [host]: ip };
}

function getSupabase(): SupabaseClient {
    if (_supabase) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');

    // Optional cPanel-only DNS bypass. Configure BOTH SUPABASE_DNS_HOST and
    // SUPABASE_HARDCODED_IP when CageFS cannot resolve the Supabase hostname.
    // No project hostname or fallback IP is embedded here because Supabase's
    // Cloudflare address can rotate and is deployment-specific.
    const _DNS_MAP = _buildSupabaseDnsMap(process.env);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function _envDnsLookup(hostname: string, options: any, callback: (err: Error | null, address: string, family: number) => void): void {
        if (_DNS_MAP[hostname]) return callback(null, _DNS_MAP[hostname], 4);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('dns').lookup(hostname, options, callback);
    }
    let baseFetch: typeof fetch = globalThis.fetch;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const undici = require('undici') as any;
        if (Object.keys(_DNS_MAP).length > 0) {
            const agent = new undici.Agent({ connect: { family: 4, lookup: _envDnsLookup } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            baseFetch = (input, init) => undici.fetch(input, { ...(init ?? {}), dispatcher: agent } as any);
        }
    } catch {
        // undici not available — fall back to global fetch
    }

    // Give every Supabase REST call a 20-second hard timeout.
    const fetchWithTimeout: typeof fetch = (input, init) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        return baseFetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    };
    _supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchWithTimeout },
    });
    return _supabase;
}

function isExpired(exp: string | null): boolean {
    return !!exp && new Date(exp) <= new Date();
}

// ─── PostgREST result-limit safety ────────────────────────────────────────────
// PostgREST silently caps every response at the project's max-rows setting
// (Supabase default: 1000 rows) — it does NOT error, it just truncates. The
// production kv_store already holds >4k rows and the `save-snapshot:*` prefix
// alone is near the cap, so an unpaginated keys()/mget() would silently drop
// matches (incomplete snapshot dedup, truncated admin restore lists, partial
// batch deletes). Reads paginate with .range(); .in() inputs are chunked so a
// batch can never exceed one page (and the filter URL stays bounded).
const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_IN_CHUNK = 200;

export function _chunkArray<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
    return out;
}

/**
 * Drain a paginated PostgREST query: `fetchPage(from, to)` returns one
 * inclusive `.range(from, to)` page; pages are requested until one comes back
 * short. Ordering must be stable (callers order by key) or rows could repeat/
 * skip across pages.
 */
export async function _collectPaginated<Row>(
    fetchPage: (from: number, to: number) => Promise<Row[]>,
    pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<Row[]> {
    const all: Row[] = [];
    for (let from = 0; ; from += pageSize) {
        const page = await fetchPage(from, from + pageSize - 1);
        all.push(...page);
        if (page.length < pageSize) return all;
    }
}

const supabaseKv = {
    async get<T = unknown>(key: string): Promise<T | null> {
        const db = getSupabase();
        const { data, error } = await db.from('kv_store').select('value, expires_at').eq('key', key).maybeSingle();
        if (error) throw new Error(`kv.get(${key}): ${error.message}`);
        if (!data) return null;
        if (isExpired(data.expires_at as string | null)) {
            void db.from('kv_store').delete().eq('key', key);
            return null;
        }
        return data.value as T;
    },

    async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { data, error } = await db.rpc('kv_set_nx', { p_key: key, p_value: value, p_expires_at: exp });
            if (error) throw new Error(`kv.set NX(${key}): ${error.message}`);
            return data ? 'OK' : null;
        }
        const { error } = await db.from('kv_store').upsert(
            { key, value, expires_at: exp, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );
        if (error) throw new Error(`kv.set(${key}): ${error.message}`);
        return 'OK';
    },

    async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }): Promise<boolean> {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { data, error } = await db.rpc('kv_compare_set', {
            p_key: key,
            p_expected: expected,
            p_value: value,
            p_expires_at: exp,
        });
        if (error) throw new Error(`kv.compareSet(${key}): ${error.message}`);
        return data === true;
    },

    async del(...keys: string[]): Promise<number> {
        if (!keys.length) return 0;
        const db = getSupabase();
        // Chunked so a bulk delete (server-reset, cleanup sweeps) can't build an
        // oversized .in() filter URL. DELETE itself has no row cap, but the
        // filter list rides the request line — keep it bounded like mget.
        let total = 0;
        for (const chunk of _chunkArray(keys, SUPABASE_IN_CHUNK)) {
            const { count, error } = await db.from('kv_store').delete({ count: 'exact' }).in('key', chunk);
            if (error) throw new Error(`kv.del: ${error.message}`);
            total += count ?? 0;
        }
        return total;
    },

    async delIfEqual(key: string, expected: string): Promise<boolean> {
        const db = getSupabase();
        // Retired Vercel/Supabase-REST backend — locks route to pgKv on
        // Railway/cPanel, so this is never on the real lock path. Filtering the
        // JSONB `value` column with a scalar .eq can be finicky in PostgREST, so
        // this fails SAFE: on ANY error it deletes nothing and returns false, so
        // the lock simply lingers to its short TTL rather than risking deleting a
        // different holder's lock. Never throws (a lock release must not error).
        const { count, error } = await db.from('kv_store').delete({ count: 'exact' }).eq('key', key).eq('value', expected);
        if (error) return false;
        return (count ?? 0) > 0;
    },

    async incr(key: string, options?: { ex?: number }): Promise<number> {
        const db = getSupabase();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        const { data, error } = await db.rpc('kv_incr', { p_key: key, p_expires_at: exp });
        if (error) throw new Error(`kv.incr(${key}): ${error.message}`);
        return Number(data);
    },

    async keys(pattern: string): Promise<string[]> {
        const db = getSupabase();
        // Fetch key + expires_at and filter expiry client-side.
        // Avoid putting a timestamp inside .or() — the colons in ISO strings
        // confuse the PostgREST filter parser and cause consistent 500 errors.
        // Paginated: PostgREST truncates at max-rows (default 1000) without an
        // error, so a single-request scan silently drops matches past the cap.
        const rows = await _collectPaginated(async (from, to) => {
            const { data, error } = await db
                .from('kv_store').select('key, expires_at')
                .like('key', _toSqlPattern(pattern))
                .order('key')
                .range(from, to);
            if (error) throw new Error(`kv.keys(${pattern}): ${error.message}`);
            return (data ?? []) as { key: string; expires_at: string | null }[];
        });
        const now = Date.now();
        return rows
            .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
            .map((r) => r.key);
    },

    async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
        if (!keys.length) return [];
        const db = getSupabase();
        // Same pattern as keys(): fetch expires_at and filter client-side
        // to avoid the PostgREST timestamp colon parsing bug.
        // Chunked: a chunk of ≤ SUPABASE_IN_CHUNK keys can never exceed one
        // PostgREST page (so no silent truncation) and keeps the .in() filter
        // URL bounded. Input order and duplicate keys are preserved by the
        // final map-back over the caller's original key list.
        const map = new Map<string, unknown>();
        const now = Date.now();
        for (const chunk of _chunkArray(keys, SUPABASE_IN_CHUNK)) {
            const { data, error } = await db
                .from('kv_store').select('key, value, expires_at')
                .in('key', chunk);
            if (error) throw new Error(`kv.mget: ${error.message}`);
            for (const r of (data ?? []) as { key: string; value: unknown; expires_at: string | null }[]) {
                if (!r.expires_at || new Date(r.expires_at).getTime() > now) map.set(r.key, r.value);
            }
        }
        return keys.map((k) => (map.has(k) ? (map.get(k) as T[number]) : null));
    },

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        return supabaseKv.get<T>(key);
    },

    async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
        // REST backend has no keys-only projection — fall back to a full read.
        // Acceptable: the huge shared-image hashes route to the disk overlay,
        // never to this backend; base-store hashes are small.
        const all = await supabaseKv.hgetall<Record<string, unknown>>(key);
        if (!all || typeof all !== 'object') return [];
        return options?.nonEmptyStrings
            ? Object.entries(all).filter(([, value]) => typeof value === 'string' && value.length > 0).map(([field]) => field)
            : Object.keys(all);
    },

    async hset(key: string, fields: Record<string, unknown>): Promise<number> {
        const db = getSupabase();
        const { error } = await db.rpc('kv_hset', { p_key: key, p_fields: fields });
        if (error) {
            console.warn(`kv.hset RPC failed, using fallback: ${error.message}`);
            const existing = (await supabaseKv.get<Record<string, unknown>>(key)) ?? {};
            await supabaseKv.set(key, { ...existing, ...fields });
        }
        return Object.keys(fields).length;
    },

    async hdel(key: string, ...fields: string[]): Promise<number> {
        if (!fields.length) return 0;
        const db = getSupabase();
        const { error } = await db.rpc('kv_hdel', { p_key: key, p_fields: fields });
        if (error) {
            console.warn(`kv.hdel RPC failed, using fallback: ${error.message}`);
            const existing = (await supabaseKv.get<Record<string, unknown>>(key)) ?? {};
            for (const f of fields) delete existing[f];
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
const _DISK_PREFIXES = ['save:', 'shared:images', 'shared:imgfields'] as const;
const _SNAPSHOT_PREFIX = 'save-snapshot:';
function _routesToDisk(keyOrPattern: string): boolean {
    return _DISK_PREFIXES.some((p) => keyOrPattern.startsWith(p));
}
function _routesToSnapshotBase(keyOrPattern: string): boolean {
    return keyOrPattern.startsWith(_SNAPSHOT_PREFIX);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fs = require('node:fs') as typeof import('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _nodePath = require('node:path') as typeof import('node:path');

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
function _keyToPath(root: string, key: string): string {
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
function _pathToKey(root: string, fullPath: string): string {
    let rel = _nodePath.relative(root, fullPath);
    if (rel.endsWith('.json')) rel = rel.slice(0, -5);
    return rel.split(_nodePath.sep).map((s) => decodeURIComponent(s)).join(':');
}

interface _DiskRecord { value: unknown; expires_at: string | null; }

async function _diskRead(root: string, key: string): Promise<_DiskRecord | null> {
    try {
        const txt = await _fs.promises.readFile(_keyToPath(root, key), 'utf8');
        return JSON.parse(txt) as _DiskRecord;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
    }
}

async function _diskWrite(root: string, key: string, rec: _DiskRecord): Promise<void> {
    const target = _keyToPath(root, key);
    await _fs.promises.mkdir(_nodePath.dirname(target), { recursive: true });
    const tmp = target + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await _fs.promises.writeFile(tmp, JSON.stringify(rec), 'utf8');
    await _fs.promises.rename(tmp, target);
}

async function _diskUnlink(root: string, key: string): Promise<boolean> {
    try {
        await _fs.promises.unlink(_keyToPath(root, key));
        return true;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw e;
    }
}

// ─── Disk mutation serialization ──────────────────────────────────────────────
//
// Every disk writer (plain set/del, NX, hash RMW, and compareSet) participates
// in one crash-released OS-backed mutex. The old expiring lockfile could be
// "stolen" from a live but paused process; that process could then resume and
// overwrite its successor — exactly the stale-writer failure CAS must prevent.
//
// SQLite's BEGIN IMMEDIATE lock is released by the OS when a process exits and
// is never lease-stolen while the holder is merely slow/suspended. Sixty-four
// shard databases avoid serializing the entire rollback store while bounding
// lock-file count. A same-process promise chain per shard prevents a synchronous
// busy wait from blocking the event loop that must finish the current holder.

function _diskLockShardPath(root: string, key: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const shard = ((hash >>> 0) & 0x3f).toString(16).padStart(2, '0');
    return _nodePath.join(root, '.kv-locks', `${shard}.sqlite`);
}

const _diskRmwChains = new Map<string, Promise<unknown>>();

async function _withDiskKeyLock<T>(root: string, key: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = _diskLockShardPath(root, key);
    const chainKey = _nodePath.resolve(lockPath);
    const prev = _diskRmwChains.get(chainKey) ?? Promise.resolve();
    const run = prev.then(async () => {
        await _fs.promises.mkdir(_nodePath.dirname(lockPath), { recursive: true });
        // Lazy-load so the active Postgres path remains compatible with any
        // Node 22 build; the retired disk rollback requires node:sqlite (22.5+)
        // and fails closed at first use if an operator enables it on older Node.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
        const db = new DatabaseSync(lockPath);
        let transactionOpen = false;
        try {
            db.exec('PRAGMA busy_timeout = 10000; BEGIN IMMEDIATE;');
            transactionOpen = true;
            const result = await fn();
            db.exec('COMMIT;');
            transactionOpen = false;
            return result;
        } catch (error) {
            if (transactionOpen) {
                try { db.exec('ROLLBACK;'); } catch { /* connection close is the final unlock */ }
            }
            throw error;
        } finally {
            db.close();
        }
    });
    // Chain survives rejections (next op still runs); drop the map entry once idle.
    const tail = run.then(() => {}, () => {});
    _diskRmwChains.set(chainKey, tail);
    void tail.then(() => {
        if (_diskRmwChains.get(chainKey) === tail) _diskRmwChains.delete(chainKey);
    });
    return run;
}

async function _walkJson(dir: string, out: string[]): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
        entries = await _fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
    }
    for (const e of entries) {
        const full = _nodePath.join(dir, e.name);
        if (e.isDirectory()) await _walkJson(full, out);
        else if (e.isFile() && e.name.endsWith('.json') && !e.name.includes('.tmp-')) out.push(full);
    }
}

function _patternToRegex(pattern: string): RegExp {
    return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

export interface KvLike {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null>;
    /**
     * Atomically replace a live row only when its complete stored JSON value
     * equals `expected`. `expected === null` means the row must be absent (an
     * expired row counts as absent). On success, `options.ex` replaces the TTL;
     * omitting it clears the TTL, exactly like set(). A mismatch changes
     * neither value nor expiry.
     *
     * This is the storage-level fencing primitive for cross-row sagas: the
     * comparison and write must be one indivisible backend operation. Callers
     * recover a commit-with-lost-ack by reading back the exact intended value;
     * adapters therefore must not retry a state-changing CAS automatically.
     */
    compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }): Promise<boolean>;
    del(...keys: string[]): Promise<number>;
    /**
     * Atomically delete `key` only if its stored value still equals `expected`.
     * Returns true iff a row was deleted. This is the compare-and-delete a lease
     * lock needs on release (see api/_lock.ts): a plain get-then-del races the
     * case where the lock's TTL expired and a NEW holder re-acquired it between
     * the read and the delete — the old holder would then delete the new holder's
     * lock. A single conditional delete closes that window.
     *
     * Fails SAFE by construction: a backend that cannot match the value deletes
     * nothing (the lock simply lingers until its short TTL and auto-evicts) — it
     * can never delete a different holder's lock. `expected` is always a string
     * (the lock's owner token).
     */
    delIfEqual(key: string, expected: string): Promise<boolean>;
    // Atomic increment — returns the post-increment counter value. Backed by the
    // kv_incr RPC on Postgres/Supabase so the rate limiter can't be raced (a
    // read-then-set RMW let concurrent requests all read the same value and all
    // pass). Disk/remote overlays fall back to a non-atomic RMW, but no
    // disk-routed key (save:/shared:) ever uses incr, so that path is never hit.
    incr(key: string, options?: { ex?: number }): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]>;
    hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>;
    /**
     * KEYS-ONLY read of an object-valued key (hash field names, or the keys of
     * a plain JSON-object value). Exists because hgetall on the multi-megabyte
     * shared-image hashes transfers the whole blob just to list ids — hkeys
     * extracts the names where the data lives (SQL/proxy-side) and ships only
     * a few KB. Returns [] for a missing/empty/non-object value; THROWS on
     * transport failure (callers distinguish "empty" from "unavailable").
     */
    hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]>;
    hset(key: string, fields: Record<string, unknown>): Promise<number>;
    hdel(key: string, ...fields: string[]): Promise<number>;
}

type MemoryKvEntry = { value: unknown; expiresAt: number | null };

/** JSONB-style structural equality (object key order is not significant). */
function _jsonValueEqual(a: unknown, b: unknown): boolean {
    const canonical = (value: unknown): string | null => {
        try {
            const visit = (node: unknown): unknown => {
                if (Array.isArray(node)) return node.map(visit);
                if (node && typeof node === 'object') {
                    const out: Record<string, unknown> = {};
                    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
                        out[key] = visit((node as Record<string, unknown>)[key]);
                    }
                    return out;
                }
                return node;
            };
            // Match JSON/JSONB storage semantics before canonicalizing. This
            // rejects cycles and normalizes values such as NaN the same way a
            // JSON transport does.
            const encoded = JSON.stringify(value);
            if (encoded === undefined) return null;
            return JSON.stringify(visit(JSON.parse(encoded)));
        } catch {
            return null;
        }
    };
    const left = canonical(a);
    return left !== null && left === canonical(b);
}

/**
 * Process-local KV used only by the explicit story/release certification
 * harness. It mirrors the JSON isolation and TTL/NX/hash semantics that the
 * production adapters expose, while guaranteeing that a local QA run cannot
 * read or mutate staging/production storage.
 */
export function _makeMemoryKv(): KvLike {
    const entries = new Map<string, MemoryKvEntry>();
    const clone = <T>(value: T): T => structuredClone(value);
    const liveEntry = (key: string): MemoryKvEntry | null => {
        const entry = entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            entries.delete(key);
            return null;
        }
        return entry;
    };
    const write = (key: string, value: unknown, ex?: number): void => {
        entries.set(key, {
            value: clone(value),
            expiresAt: ex ? Date.now() + ex * 1000 : null,
        });
    };

    return {
        async get<T = unknown>(key: string): Promise<T | null> {
            const entry = liveEntry(key);
            return entry ? clone(entry.value as T) : null;
        },
        async set(key, value, options) {
            if (options?.nx && liveEntry(key)) return null;
            write(key, value, options?.ex);
            return 'OK';
        },
        async compareSet(key, expected, value, options) {
            const entry = liveEntry(key);
            if (expected === null ? entry !== null : !entry || !_jsonValueEqual(entry.value, expected)) return false;
            write(key, value, options?.ex);
            return true;
        },
        async del(...keys) {
            let deleted = 0;
            for (const key of keys) if (entries.delete(key)) deleted += 1;
            return deleted;
        },
        async delIfEqual(key, expected) {
            const entry = liveEntry(key);
            if (!entry || entry.value !== expected) return false;
            entries.delete(key);
            return true;
        },
        async incr(key, options) {
            const current = Number(liveEntry(key)?.value ?? 0);
            const next = current + 1;
            write(key, next, options?.ex);
            return next;
        },
        async keys(pattern) {
            const re = _patternToRegex(pattern);
            const keys: string[] = [];
            for (const key of entries.keys()) {
                if (liveEntry(key) && re.test(key)) keys.push(key);
            }
            return keys;
        },
        async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
            return keys.map((key) => {
                const entry = liveEntry(key);
                return entry ? clone(entry.value as T[number]) : null;
            });
        },
        async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
            const entry = liveEntry(key);
            return entry ? clone(entry.value as T) : null;
        },
        async hkeys(key, options) {
            const entry = liveEntry(key);
            if (!entry || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) return [];
            const value = entry.value as Record<string, unknown>;
            return options?.nonEmptyStrings
                ? Object.entries(value).filter(([, fieldValue]) => typeof fieldValue === 'string' && fieldValue.length > 0).map(([field]) => field)
                : Object.keys(value);
        },
        async hset(key, fields) {
            const entry = liveEntry(key);
            const current = entry?.value && typeof entry.value === 'object' && !Array.isArray(entry.value)
                ? clone(entry.value as Record<string, unknown>)
                : {};
            let added = 0;
            for (const [field, value] of Object.entries(fields)) {
                if (!(field in current)) added += 1;
                current[field] = clone(value);
            }
            write(key, current);
            return added;
        },
        async hdel(key, ...fields) {
            const entry = liveEntry(key);
            if (!entry || !entry.value || typeof entry.value !== 'object' || Array.isArray(entry.value)) return 0;
            const current = clone(entry.value as Record<string, unknown>);
            let deleted = 0;
            for (const field of fields) {
                if (field in current) {
                    delete current[field];
                    deleted += 1;
                }
            }
            write(key, current);
            return deleted;
        },
    };
}

export function _makeDiskKv(root: string): KvLike {
    return {
        async get<T = unknown>(key: string): Promise<T | null> {
            const rec = await _diskRead(root, key);
            if (!rec) return null;
            if (isExpired(rec.expires_at)) {
                await _diskUnlink(root, key).catch(() => {});
                return null;
            }
            return rec.value as T;
        },
        async set(key, value, options) {
            const exp = options?.ex ? expiresAt(options.ex) : null;
            // Every whole-value writer participates in the same per-key lock as
            // compareSet. Otherwise a plain set could slip between CAS's read
            // and rename and violate the advertised atomic boundary.
            return _withDiskKeyLock(root, key, async () => {
                if (options?.nx) {
                    const existing = await _diskRead(root, key);
                    if (existing && !isExpired(existing.expires_at)) return null;
                }
                await _diskWrite(root, key, { value, expires_at: exp });
                return 'OK' as const;
            });
        },
        async compareSet(key, expected, value, options) {
            const exp = options?.ex ? expiresAt(options.ex) : null;
            return _withDiskKeyLock(root, key, async () => {
                const existing = await _diskRead(root, key);
                const live = existing && !isExpired(existing.expires_at) ? existing : null;
                if (expected === null ? live !== null : !live || !_jsonValueEqual(live.value, expected)) return false;
                await _diskWrite(root, key, { value, expires_at: exp });
                return true;
            });
        },
        async del(...keys) {
            let n = 0;
            for (const k of keys) {
                if (await _withDiskKeyLock(root, k, () => _diskUnlink(root, k))) n++;
            }
            return n;
        },
        async delIfEqual(key, expected) {
            // Serialized read-compare-unlink under the same per-key lock the RMW
            // ops use, so it is atomic against a concurrent nx-claim on this file.
            return _withDiskKeyLock(root, key, async () => {
                const rec = await _diskRead(root, key);
                if (!rec || isExpired(rec.expires_at) || rec.value !== expected) return false;
                return _diskUnlink(root, key);
            });
        },
        // Non-atomic RMW. Disk-routed keys (save:/shared:) never use incr, so
        // this exists only to satisfy KvLike — the rate limiter's incr always
        // routes to the base Postgres/Supabase store (atomic kv_incr).
        async incr(key, options) {
            const cur = Number((await this.get<number>(key)) ?? 0);
            const next = cur + 1;
            await this.set(key, next, options);
            return next;
        },
        async keys(pattern) {
            const files: string[] = [];
            await _walkJson(root, files);
            const re = _patternToRegex(pattern);
            const out: string[] = [];
            for (const f of files) {
                const k = _pathToKey(root, f);
                if (re.test(k)) out.push(k);
            }
            return out;
        },
        async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
            const results = await Promise.all(keys.map((k) => this.get<T[number]>(k)));
            return results;
        },
        async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
            return this.get<T>(key);
        },
        async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
            // Local disk read — fast even for big blobs; only the names leave.
            const all = await this.get<Record<string, unknown>>(key);
            if (!all || typeof all !== 'object') return [];
            return options?.nonEmptyStrings
                ? Object.entries(all).filter(([, value]) => typeof value === 'string' && value.length > 0).map(([field]) => field)
                : Object.keys(all);
        },
        async hset(key, fields) {
            // Serialized RMW — see _withDiskKeyLock. Unserialized, concurrent
            // hsets read the same snapshot and the last write drops the other
            // writers' fields (lost image-manifest ids under parallel publishes).
            return _withDiskKeyLock(root, key, async () => {
                const rec = await _diskRead(root, key);
                const existing = rec && !isExpired(rec.expires_at) && rec.value && typeof rec.value === 'object' && !Array.isArray(rec.value)
                    ? rec.value as Record<string, unknown>
                    : {};
                await _diskWrite(root, key, { value: { ...existing, ...fields }, expires_at: null });
                return Object.keys(fields).length;
            });
        },
        async hdel(key, ...fields) {
            if (!fields.length) return 0;
            return _withDiskKeyLock(root, key, async () => {
                const rec = await _diskRead(root, key);
                const existing = rec && !isExpired(rec.expires_at) && rec.value && typeof rec.value === 'object' && !Array.isArray(rec.value)
                    ? { ...rec.value as Record<string, unknown> }
                    : {};
                for (const f of fields) delete existing[f];
                await _diskWrite(root, key, { value: existing, expires_at: null });
                return fields.length;
            });
        },
    };
}

// ─── Remote KV (HTTP client → cPanel proxy) ──────────────────────────────────

const PRODUCTION_KV_PROXY_HOSTS = new Set(['theravensark.com', 'www.theravensark.com']);
const REMOTE_KV_OPS = new Set(['get', 'set', 'compare-set', 'del', 'keys', 'mget', 'hget', 'hset', 'hdel', 'hgetall', 'hkeys']);

/**
 * A KV proxy receives the bearer-equivalent storage token on every request, so
 * its destination must never be an arbitrary environment/user URL. Keep the
 * production host list compiled into the release; changing storage providers
 * requires a reviewed code change rather than a mutable allowlist variable.
 */
export function _validatedRemoteKvBaseUrl(
    raw: string,
    allowedHosts: ReadonlySet<string> = PRODUCTION_KV_PROXY_HOSTS,
): string {
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw new Error('KV_PROXY_URL must be a valid URL.'); }
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (parsed.protocol !== 'https:') throw new Error('KV_PROXY_URL must use HTTPS.');
    if (!allowedHosts.has(hostname)) throw new Error(`KV_PROXY_URL host is not approved: ${hostname}`);
    if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('KV_PROXY_URL must not contain credentials, a port, query, or fragment.');
    }
    if (pathname !== '/api/kv') throw new Error('KV_PROXY_URL path must be exactly /api/kv.');
    return `https://${hostname}/api/kv`;
}

export function _makeRemoteKv(
    baseUrl: string,
    token: string,
    opts?: { allowedHosts?: ReadonlySet<string> },
): KvLike {
    const safeBaseUrl = _validatedRemoteKvBaseUrl(baseUrl, opts?.allowedHosts);
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
    const RETRY_DELAY_MS = 150;      // linear backoff between tries: 150ms, 300ms
    const POINT_TIMEOUT_MS = 8_000;  // abort a hung point op; bulk scans pass 0 (no timeout)

    async function call<T>(
        op: string,
        body: unknown,
        opts?: { retryable?: boolean; timeoutMs?: number },
    ): Promise<T> {
        if (!REMOTE_KV_OPS.has(op)) throw new Error(`Unsupported remote KV operation: ${op}`);
        const maxAttempts = opts?.retryable === false ? 1 : MAX_ATTEMPTS;
        const timeoutMs = opts?.timeoutMs ?? POINT_TIMEOUT_MS;
        let lastErr: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let transient = false;
            // Per-attempt timeout using the same AbortController idiom as the
            // Supabase fetchWithTimeout above. Skipped (no signal) when
            // timeoutMs <= 0 so a legitimately slow keys/mget scan over a big
            // cPanel keyspace is never aborted mid-walk.
            const ctrl = timeoutMs > 0 ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
            try {
                const r = await fetch(`${safeBaseUrl}/${op}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-kv-token': token },
                    body: JSON.stringify(body),
                    signal: ctrl?.signal,
                });
                if (r.ok) return (await r.json()) as T;
                lastErr = new Error(`remoteKv ${op}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
                transient = RETRY_STATUS.has(r.status);
            } catch (e) {
                // fetch threw: DNS/connection error, or the abort timeout fired
                // (AbortError). Both are transient — worth another attempt.
                lastErr = e;
                transient = true;
            } finally {
                if (timer) clearTimeout(timer);
            }
            if (!transient || attempt >= maxAttempts) break;
            await new Promise((res) => setTimeout(res, RETRY_DELAY_MS * attempt));
        }
        throw lastErr;
    }
    return {
        async get<T = unknown>(key: string): Promise<T | null> {
            return (await call<{ value: T | null }>('get', { key })).value;
        },
        async set(key, value, options) {
            // nx claims are check-then-write: not safe to retry (a lost 2xx would
            // make the retry observe the existing claim and report "not claimed").
            // Plain sets re-apply the same value — retryable.
            return (await call<{ result: 'OK' | null }>('set', { key, value, options }, { retryable: !options?.nx })).result;
        },
        async compareSet(key, expected, value, options) {
            // A lost 2xx may mean the swap committed; automatically repeating
            // would report false against the new value and erase that ambiguity.
            // Saga callers resolve it with an exact readback instead.
            return (await call<{ swapped: boolean }>(
                'compare-set',
                { key, expected, value, options },
                { retryable: false },
            )).swapped;
        },
        async del(...keys) {
            return (await call<{ count: number }>('del', { keys })).count;
        },
        async delIfEqual(key, expected) {
            // Lock keys are `lock:*` (base-routed), so a compare-and-delete never
            // reaches the remote overlay. Kept for KvLike conformance as a
            // best-effort read-then-conditional-delete; the proxy exposes no
            // atomic CAS op, so do not route a lock here.
            const cur = await this.get<unknown>(key);
            if (cur !== expected) return false;
            return (await this.del(key)) > 0;
        },
        // Non-atomic RMW over the proxy. Never used for disk-routed keys (the
        // only keys that reach the remote overlay), so the rate limiter never
        // hits this path — see the routed incr below.
        async incr(key, options) {
            const cur = Number((await this.get<number>(key)) ?? 0);
            const next = cur + 1;
            await this.set(key, next, options);
            return next;
        },
        async keys(pattern) {
            // Whole-keyspace walk on the cPanel disk — legitimately slow over a
            // large save keyspace, so no client abort timeout (timeoutMs: 0).
            // Still retried on transient transport failures.
            return (await call<{ keys: string[] }>('keys', { pattern }, { timeoutMs: 0 })).keys;
        },
        async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
            // Batched multi-key read — can be large (the snapshot cron mgets many
            // saves at once); no client abort timeout for the same reason as keys.
            return (await call<{ values: (T[number] | null)[] }>('mget', { keys }, { timeoutMs: 0 })).values;
        },
        async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
            return (await call<{ value: T | null }>('get', { key })).value;
        },
        async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
            // Proxy-side key extraction — the whole point: the multi-MB image
            // hash stays on the cPanel box; only the id list crosses the wire.
            const result = await call<{ fields: string[]; nonEmptyStringsApplied?: boolean }>('hkeys', { key, options });
            // During a rolling deploy an older proxy ignores the new option.
            // Fail explicitly so the image manifest can use its correct (but
            // temporarily heavier) hgetall fallback instead of leaking tombstones.
            if (options?.nonEmptyStrings && result.nonEmptyStringsApplied !== true) {
                throw new Error('Remote KV proxy does not support filtered hkeys yet.');
            }
            return result.fields;
        },
        async hset(key, fields) {
            return (await call<{ count: number }>('hset', { key, fields })).count;
        },
        async hdel(key, ...fields) {
            return (await call<{ count: number }>('hdel', { key, fields })).count;
        },
    };
}

// ─── Routing wrapper ──────────────────────────────────────────────────────────

export function _makeRoutedKv(base: KvLike, disk: KvLike): KvLike {
    function split(keys: string[]): { diskKeys: string[]; baseKeys: string[]; order: ('disk' | 'base')[] } {
        const diskKeys: string[] = [];
        const baseKeys: string[] = [];
        const order: ('disk' | 'base')[] = [];
        for (const k of keys) {
            if (_routesToDisk(k)) { diskKeys.push(k); order.push('disk'); }
            else { baseKeys.push(k); order.push('base'); }
        }
        return { diskKeys, baseKeys, order };
    }
    // Disk is now the source of truth for disk-routed prefixes — migration is
    // complete (see /api/admin/migrate-kv). Reads go straight to the overlay.
    async function diskGet<T>(key: string): Promise<T | null> {
        return disk.get<T>(key);
    }
    async function snapshotGet<T>(key: string): Promise<T | null> {
        const primary = await base.get<T>(key);
        return primary === null ? disk.get<T>(key) : primary;
    }
    return {
        async get<T = unknown>(key: string): Promise<T | null> {
            if (_routesToSnapshotBase(key)) return snapshotGet<T>(key);
            return _routesToDisk(key) ? diskGet<T>(key) : base.get<T>(key);
        },
        async set(key, value, options) {
            return _routesToDisk(key) ? disk.set(key, value, options) : base.set(key, value, options);
        },
        async compareSet(key, expected, value, options) {
            return _routesToDisk(key)
                ? disk.compareSet(key, expected, value, options)
                : base.compareSet(key, expected, value, options);
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
        async delIfEqual(key, expected) {
            // Lock keys (`lock:*`) are base-routed, so this resolves to the base
            // store's atomic compare-and-delete on every real deployment.
            return _routesToDisk(key) ? disk.delIfEqual(key, expected) : base.delIfEqual(key, expected);
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
        async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
            // Batch per backend so the remote (Vercel) disk overlay does ONE
            // round-trip for all disk-routed keys instead of one HTTP call per
            // key. Migration is complete, so disk reads no longer need a per-key
            // fallback path (see diskGet above). Results are re-interleaved into
            // the caller's original key order — byte-identical to the per-key
            // path, just fewer network calls.
            const { diskKeys, baseKeys, order } = split(keys);
            const [diskVals, baseVals] = await Promise.all([
                diskKeys.length ? disk.mget<T>(...diskKeys) : Promise.resolve([] as (T[number] | null)[]),
                baseKeys.length ? base.mget<T>(...baseKeys) : Promise.resolve([] as (T[number] | null)[]),
            ]);
            const out: (T[number] | null)[] = [];
            let di = 0, bi = 0;
            for (const src of order) out.push(src === 'disk' ? diskVals[di++] : baseVals[bi++]);
            const fallbackIndexes = keys
                .map((key, index) => ({ key, index }))
                .filter(({ key, index }) => _routesToSnapshotBase(key) && out[index] === null);
            if (fallbackIndexes.length) {
                const legacy = await disk.mget<T>(...fallbackIndexes.map(({ key }) => key));
                fallbackIndexes.forEach(({ index }, i) => { out[index] = legacy[i]; });
            }
            return out;
        },
        async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
            if (_routesToSnapshotBase(key)) return snapshotGet<T>(key);
            return _routesToDisk(key) ? diskGet<T>(key) : base.hgetall<T>(key);
        },
        async hkeys(key: string, options?: { nonEmptyStrings?: boolean }): Promise<string[]> {
            return _routesToDisk(key) ? disk.hkeys(key, options) : base.hkeys(key, options);
        },
        async hset(key, fields) {
            return _routesToDisk(key) ? disk.hset(key, fields) : base.hset(key, fields);
        },
        async hdel(key, ...fields) {
            return _routesToDisk(key) ? disk.hdel(key, ...fields) : base.hdel(key, ...fields);
        },
    };
}

export type DiskMigrationResult = {
    migrated: string[];
    alreadyPresent: string[];
    conflicts: string[];
    skipped: string[];
    deleted: number;
};

function migrationValueEqual(a: unknown, b: unknown): boolean {
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
export async function _migrateDiskRoutedKeys(
    base: KvLike,
    overlay: KvLike,
    prefixes: readonly string[],
    opts?: { dryRun?: boolean },
): Promise<DiskMigrationResult> {
    const migrated: string[] = [];
    const alreadyPresent: string[] = [];
    const conflicts: string[] = [];
    const skipped: string[] = [];
    let deleted = 0;
    for (const prefix of prefixes) {
        const ks = await base.keys(prefix + '*');
        for (const k of ks) {
            const source = await base.get(k);
            if (source === null || source === undefined) { skipped.push(k); continue; }
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
            if (opts?.dryRun) { migrated.push(k); continue; }

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
export async function migrateDiskRoutedKeysToOverlay(opts?: { dryRun?: boolean }): Promise<DiskMigrationResult> {
    if (!_diskOverlay) throw new Error('No disk overlay configured (set DISK_KV_DIR or KV_PROXY_URL).');
    return _migrateDiskRoutedKeys(_baseKv, _diskOverlay, _DISK_PREFIXES, opts);
}

// ─── Retire-the-overlay copy (overlay → base) ─────────────────────────────────
//
// The REVERSE of _migrateDiskRoutedKeys, for decommissioning the disk overlay /
// cPanel proxy: it copies every disk-routed key (save:*, shared:images*,
// shared:imgfields*) FROM the overlay INTO the base store so `save:*` can live in
// Postgres like everything else. Two deliberate differences from the migrate-TO-
// overlay path make this safe for a live cutover:
//   1. It NEVER deletes the source. The overlay is left fully intact, so the
//      cutover is reversible by simply re-pointing the env back at it (no data
//      restore needed). Decommission the overlay only after a soak.
//   2. It OVERWRITES the base value (upsert), because the overlay is the source
//      of truth for these prefixes and the base may still hold stale legacy
//      copies from before the original disk migration — an NX write would let a
//      stale base row win. Every write is read back and compared; a mismatch is
//      reported, never silently accepted. Idempotent: safe to re-run (e.g. to
//      catch a straggler written between a first pass and the env flip).
export type BaseCopyResult = {
    copied: number;
    verified: number;
    skipped: number;
    sourceCount: number;
    /** Keys whose base read-back did NOT equal the overlay source (must be zero to cut over). */
    mismatches: string[];
};

export async function _copyDiskRoutedKeysToBase(
    overlay: KvLike,
    base: KvLike,
    prefixes: readonly string[],
    opts?: { dryRun?: boolean },
): Promise<BaseCopyResult> {
    let copied = 0;
    let verified = 0;
    let skipped = 0;
    let sourceCount = 0;
    const mismatches: string[] = [];
    for (const prefix of prefixes) {
        const ks = await overlay.keys(prefix + '*');
        for (const k of ks) {
            sourceCount += 1;
            const source = await overlay.get(k);
            if (source === null || source === undefined) { skipped += 1; continue; }
            if (opts?.dryRun) { copied += 1; continue; }
            await base.set(k, source);
            const readBack = await base.get(k);
            if (migrationValueEqual(source, readBack)) { copied += 1; verified += 1; }
            else mismatches.push(k);
        }
    }
    return { copied, verified, skipped, sourceCount, mismatches };
}

/**
 * Copy all disk-routed keys from the configured overlay into the base store, in
 * preparation for retiring the overlay (see Option B in the DB audit runbook).
 * Requires an overlay to be configured (KV_PROXY_URL or DISK_KV_DIR) — that's
 * what we're reading FROM. Never deletes the overlay.
 */
export async function copyDiskRoutedKeysToBase(opts?: { dryRun?: boolean }): Promise<BaseCopyResult> {
    if (!_diskOverlay) throw new Error('No disk overlay configured — nothing to copy from (set KV_PROXY_URL or DISK_KV_DIR).');
    return _copyDiskRoutedKeysToBase(_diskOverlay, _baseKv, _DISK_PREFIXES, opts);
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
const _qaMemoryKv = process.env.SHINOBIX_QA_MEMORY_KV === '1';
if (_qaMemoryKv && (process.env.NODE_ENV !== 'test' || _onVercel)) {
    throw new Error('[kv] SHINOBIX_QA_MEMORY_KV requires NODE_ENV=test and cannot run on Vercel.');
}
const _baseKv: KvLike = _qaMemoryKv
    ? _makeMemoryKv()
    : ((_forcePg || (_havePgUrl && !_onVercel)) ? pgKv : supabaseKv);
if (_qaMemoryKv) console.log('[kv] isolated in-memory QA backend active');

// Disk overlay (only attached when env tells us where to read/write).
const _diskRoot = _qaMemoryKv ? null : (process.env.DISK_KV_DIR ?? null);
const _proxyUrl = _qaMemoryKv ? null : (process.env.KV_PROXY_URL ?? null);
const _proxyToken = _qaMemoryKv ? null : (process.env.KV_PROXY_TOKEN ?? null);

let _diskOverlay: KvLike | null = null;
if (_diskRoot) {
    _diskOverlay = _makeDiskKv(_diskRoot);
    console.log('[kv] disk overlay active at', _diskRoot);
} else if (_proxyUrl && _proxyToken) {
    _diskOverlay = _makeRemoteKv(_proxyUrl, _proxyToken);
    console.log('[kv] remote proxy overlay active at', _proxyUrl);
}

// Fail-closed guard — RETIRED TOPOLOGY (kept for the rollback path only).
// Since the cPanel cutover (2026-07-17, docs/RETIRE_CPANEL_RUNBOOK.md) live
// saves are served from the base Postgres store and REQUIRE_DISK_OVERLAY is
// UNSET in production, so this guard is intentionally dormant. It still
// matters during a rollback: an operator re-enabling the overlay sets
// REQUIRE_DISK_OVERLAY=1 so a half-configured overlay (missing KV_PROXY_URL /
// KV_PROXY_TOKEN / DISK_KV_DIR) refuses to boot instead of silently serving
// saves from the wrong store.
if (process.env.REQUIRE_DISK_OVERLAY === '1' && !_diskOverlay) {
    throw new Error(
        '[kv] REQUIRE_DISK_OVERLAY=1 but no disk overlay is configured ' +
        '(set DISK_KV_DIR, or KV_PROXY_URL + KV_PROXY_TOKEN). Refusing to serve ' +
        'save:* from the base store.'
    );
}

export const kv = _diskOverlay ? _makeRoutedKv(_baseKv, _diskOverlay) : _baseKv;

// Which backend `save:*` keys actually resolve to, surfaced by /health?deep=1.
// Since the cPanel overlay retirement (2026-07-17) 'base-store' is the
// EXPECTED value in production — saves live in the base Postgres store. A
// 'disk'/'remote-proxy' value now means the rollback overlay has been
// deliberately re-enabled (docs/RETIRE_CPANEL_RUNBOOK.md); release health
// gates on this via EXPECTED_SAVE_STORE=base-store.
export const saveStoreKind: 'memory-qa' | 'disk' | 'remote-proxy' | 'base-store' =
    _qaMemoryKv ? 'memory-qa' : (_diskRoot ? 'disk' : ((_proxyUrl && _proxyToken) ? 'remote-proxy' : 'base-store'));

// Expose the disk backend directly for the /api/kv proxy endpoint to use.
export const _diskKvForProxy: KvLike | null = _diskRoot ? _makeDiskKv(_diskRoot) : null;
