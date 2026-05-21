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
// ─── pg Pool backend (cPanel / Passenger) ────────────────────────────────────
import pg from 'pg';
const { Pool } = pg;
let _pool = null;
function getPool() {
    if (_pool)
        return _pool;
    const url = process.env.DATABASE_URL;
    // Strip sslmode from the connection string — pg v8 treats sslmode=require
    // as verify-full, overriding ssl:{rejectUnauthorized:false}.
    const cleanUrl = url
        .replace(/([?&])sslmode=[^&]*/g, (_, sep) => (sep === '?' ? '?' : ''))
        .replace(/\?$/, '');
    _pool = new Pool({
        connectionString: cleanUrl,
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
        const db = getPool();
        const { rows } = await db.query(`SELECT value, expires_at FROM public.kv_store WHERE key = $1`, [key]);
        if (!rows.length)
            return null;
        const row = rows[0];
        if (row.expires_at && new Date(row.expires_at) <= new Date()) {
            void db.query(`DELETE FROM public.kv_store WHERE key = $1`, [key]);
            return null;
        }
        return row.value;
    },
    async set(key, value, options) {
        const db = getPool();
        const exp = options?.ex ? expiresAt(options.ex) : null;
        if (options?.nx) {
            const { rows } = await db.query(`SELECT public.kv_set_nx($1, $2::jsonb, $3::timestamptz) AS kv_set_nx`, [key, JSON.stringify(value), exp]);
            return rows[0].kv_set_nx ? 'OK' : null;
        }
        await db.query(`INSERT INTO public.kv_store (key, value, expires_at, updated_at)
             VALUES ($1, $2::jsonb, $3::timestamptz, now())
             ON CONFLICT (key) DO UPDATE
                 SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`, [key, JSON.stringify(value), exp]);
        return 'OK';
    },
    async del(...keys) {
        if (!keys.length)
            return 0;
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
        const { rows } = await getPool().query(`SELECT key, value FROM public.kv_store WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > now())`, [keys]);
        const map = new Map(rows.map((r) => [r.key, r.value]));
        return keys.map((k) => (map.has(k) ? map.get(k) : null));
    },
    async hgetall(key) {
        return pgKv.get(key);
    },
    async hset(key, fields) {
        await getPool().query(`SELECT public.kv_hset($1, $2::jsonb)`, [key, JSON.stringify(fields)]);
        return Object.keys(fields).length;
    },
    async hdel(key, ...fields) {
        if (!fields.length)
            return 0;
        await getPool().query(`SELECT public.kv_hdel($1, $2::text[])`, [key, fields]);
        return fields.length;
    },
};
// ─── Supabase REST backend (Vercel / serverless) ──────────────────────────────
import { createClient } from '@supabase/supabase-js';
let _supabase = null;
function getSupabase() {
    if (_supabase)
        return _supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
        const now = new Date().toISOString();
        const { data, error } = await db
            .from('kv_store').select('key')
            .like('key', toSqlPattern(pattern))
            .or(`expires_at.is.null,expires_at.gt.${now}`);
        if (error)
            throw new Error(`kv.keys(${pattern}): ${error.message}`);
        return (data ?? []).map((r) => r.key);
    },
    async mget(...keys) {
        if (!keys.length)
            return [];
        const db = getSupabase();
        const now = new Date().toISOString();
        const { data, error } = await db
            .from('kv_store').select('key, value')
            .in('key', keys)
            .or(`expires_at.is.null,expires_at.gt.${now}`);
        if (error)
            throw new Error(`kv.mget: ${error.message}`);
        const map = new Map((data ?? []).map((r) => [r.key, r.value]));
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
// ─── Export the right backend ─────────────────────────────────────────────────
// Use pg Pool when DATABASE_URL is set (cPanel/Passenger long-running process).
// Fall back to Supabase REST API for Vercel serverless (no TCP cold-start cost).
export const kv = process.env.DATABASE_URL ? pgKv : supabaseKv;
