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

// ─── In-process read cache ────────────────────────────────────────────────────
// On cPanel / Passenger the Node process is long-lived, so this Map survives
// across requests and acts as a free first-level cache that absorbs repeated
// reads (world-state, images, etc.) without touching Postgres at all.
// On Vercel (stateless) instances are short-lived so this is a best-effort
// bonus; CDN Cache-Control headers are the primary caching layer there.

interface CacheEntry { value: unknown; expiresAt: number; }
const _readCache = new Map<string, CacheEntry>();

// These prefixes change too rapidly to benefit from caching.
const _noCachePrefixes = ['presence:', 'challenges:', 'reset-signal:', 'admin-lock:'];

function _shouldCache(key: string): boolean {
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
    return entry.value as T;
}

function _cacheWrite(key: string, value: unknown): void {
    if (!_shouldCache(key)) return;
    _readCache.set(key, { value, expiresAt: Date.now() + _cacheTtlMs(key) });
}

function _cacheInvalidate(...keys: string[]): void {
    for (const k of keys) _readCache.delete(k);
}

// ─── pg Pool backend (cPanel / Passenger) ────────────────────────────────────

import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

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

function toSqlPattern(pattern: string): string {
    return pattern
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

    async del(...keys: string[]): Promise<number> {
        if (!keys.length) return 0;
        _cacheInvalidate(...keys);
        const { rowCount } = await getPool().query(
            `DELETE FROM public.kv_store WHERE key = ANY($1::text[])`, [keys]
        );
        return rowCount ?? 0;
    },

    async keys(pattern: string): Promise<string[]> {
        const { rows } = await getPool().query<{ key: string }>(
            `SELECT key FROM public.kv_store WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > now())`,
            [toSqlPattern(pattern)]
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

function getSupabase(): SupabaseClient {
    if (_supabase) return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    // Give every Supabase REST call a 30-second hard timeout via a custom fetch.
    // Without this, one slow JSONB serialisation on a multi-MB blob hangs the
    // Vercel function until the platform kills it (~300 s), returning no response.
    const fetchWithTimeout: typeof fetch = (input, init) => {
        const ctrl = new AbortController();
        // 20s hard cap per Supabase REST call — keeps us well under the 30s
        // maxDuration so the function always has time to return a response.
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
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

    async del(...keys: string[]): Promise<number> {
        if (!keys.length) return 0;
        const db = getSupabase();
        const { count, error } = await db.from('kv_store').delete({ count: 'exact' }).in('key', keys);
        if (error) throw new Error(`kv.del: ${error.message}`);
        return count ?? 0;
    },

    async keys(pattern: string): Promise<string[]> {
        const db = getSupabase();
        // Fetch key + expires_at and filter expiry client-side.
        // Avoid putting a timestamp inside .or() — the colons in ISO strings
        // confuse the PostgREST filter parser and cause consistent 500 errors.
        const { data, error } = await db
            .from('kv_store').select('key, expires_at')
            .like('key', toSqlPattern(pattern));
        if (error) throw new Error(`kv.keys(${pattern}): ${error.message}`);
        const now = Date.now();
        return (data ?? [])
            .filter((r: { key: string; expires_at: string | null }) =>
                !r.expires_at || new Date(r.expires_at).getTime() > now
            )
            .map((r: { key: string }) => r.key);
    },

    async mget<T extends unknown[] = unknown[]>(...keys: string[]): Promise<(T[number] | null)[]> {
        if (!keys.length) return [];
        const db = getSupabase();
        // Same pattern as keys(): fetch expires_at and filter client-side
        // to avoid the PostgREST timestamp colon parsing bug.
        const { data, error } = await db
            .from('kv_store').select('key, value, expires_at')
            .in('key', keys);
        if (error) throw new Error(`kv.mget: ${error.message}`);
        const now = Date.now();
        const map = new Map(
            (data ?? [])
                .filter((r: { key: string; value: unknown; expires_at: string | null }) =>
                    !r.expires_at || new Date(r.expires_at).getTime() > now
                )
                .map((r: { key: string; value: unknown }) => [r.key, r.value])
        );
        return keys.map((k) => (map.has(k) ? (map.get(k) as T[number]) : null));
    },

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        return supabaseKv.get<T>(key);
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

// ─── Export the right backend ─────────────────────────────────────────────────

// Use pg Pool when a direct connection URL is available:
//   DATABASE_URL      — set explicitly (cPanel/Passenger, or manually in Vercel)
//   SUPABASE_POSTGRES_URL — set automatically by the Supabase Vercel integration
// Fall back to Supabase REST API only when neither is present.
export const kv = (process.env.DATABASE_URL || process.env.SUPABASE_POSTGRES_URL) ? pgKv : supabaseKv;
