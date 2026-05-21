/**
 * Postgres KV adapter — drop-in replacement for @vercel/kv.
 *
 * Uses a direct pg Pool connection to Supabase Postgres, bypassing the
 * PostgREST REST API.  This avoids the 8-second PostgREST statement timeout
 * that kills reads of large image blobs (some rows are 10 MB+).
 *
 * Required env var:
 *   DATABASE_URL — Postgres connection string, e.g.:
 *     postgres://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres
 *
 * Storage model:
 *   Each key is one row in public.kv_store.
 *   String/JSON values → value column (JSONB).
 *   Hash values        → value column holds a JSON object; hset merges fields
 *                        atomically via the kv_hset SQL function.
 *   TTL                → stored in expires_at (timestamptz); lazily evicted on
 *                        read, and periodically by kv_delete_expired().
 */

import pg from 'pg';

const { Pool } = pg;

// ─── Connection pool (singleton) ─────────────────────────────────────────────

let _pool: pg.Pool | null = null;

function pool(): pg.Pool {
    if (_pool) return _pool;

    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error('DATABASE_URL must be set in environment.');
    }

    // Strip sslmode from the connection string — pg v8 treats sslmode=require
    // as verify-full and rejects Supabase's self-signed cert, overriding any
    // ssl option passed to the Pool constructor.  We set ssl explicitly below.
    const cleanUrl = url.replace(/([?&])sslmode=[^&]*/g, (m, sep) => sep === '?' ? '?' : '').replace(/\?$/, '');

    _pool = new Pool({
        connectionString: cleanUrl,
        ssl: { rejectUnauthorized: false },
        max: 5,                // keep a small pool — Passenger reuses the process
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });

    _pool.on('error', (err) => {
        console.error('[pg pool error]', err.message);
    });

    return _pool;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a Redis-style glob pattern to a SQL LIKE pattern. */
function toSqlPattern(pattern: string): string {
    return pattern
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/\*/g, '%')
        .replace(/\?/g, '_');
}

/** Build an ISO expires_at string from a seconds-to-live value. */
function expiresAt(ex: number): string {
    return new Date(Date.now() + ex * 1000).toISOString();
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const kv = {

    // ── get ──────────────────────────────────────────────────────────────────

    async get<T = unknown>(key: string): Promise<T | null> {
        const db = pool();
        const { rows } = await db.query<{ value: unknown; expires_at: string | null }>(
            `SELECT value, expires_at FROM public.kv_store WHERE key = $1`,
            [key]
        );
        if (rows.length === 0) return null;

        const row = rows[0];
        // Lazy expiry check.
        if (row.expires_at && new Date(row.expires_at) <= new Date()) {
            void db.query(`DELETE FROM public.kv_store WHERE key = $1`, [key]);
            return null;
        }

        // pg automatically parses JSONB → JS object/primitive.
        return row.value as T;
    },

    // ── set ──────────────────────────────────────────────────────────────────

    async set(
        key: string,
        value: unknown,
        options?: { ex?: number; nx?: boolean }
    ): Promise<'OK' | null> {
        const db = pool();
        const exp = options?.ex ? expiresAt(options.ex) : null;

        if (options?.nx) {
            // Use the kv_set_nx SQL function for atomic set-if-not-exists.
            const { rows } = await db.query<{ kv_set_nx: boolean }>(
                `SELECT public.kv_set_nx($1, $2::jsonb, $3::timestamptz) AS kv_set_nx`,
                [key, JSON.stringify(value), exp]
            );
            return rows[0].kv_set_nx ? 'OK' : null;
        }

        await db.query(
            `INSERT INTO public.kv_store (key, value, expires_at, updated_at)
             VALUES ($1, $2::jsonb, $3::timestamptz, now())
             ON CONFLICT (key) DO UPDATE
                 SET value      = EXCLUDED.value,
                     expires_at = EXCLUDED.expires_at,
                     updated_at = now()`,
            [key, JSON.stringify(value), exp]
        );
        return 'OK';
    },

    // ── del ──────────────────────────────────────────────────────────────────

    async del(...keys: string[]): Promise<number> {
        if (keys.length === 0) return 0;
        const db = pool();
        const { rowCount } = await db.query(
            `DELETE FROM public.kv_store WHERE key = ANY($1::text[])`,
            [keys]
        );
        return rowCount ?? 0;
    },

    // ── keys ─────────────────────────────────────────────────────────────────

    async keys(pattern: string): Promise<string[]> {
        const db = pool();
        const sqlPat = toSqlPattern(pattern);
        const { rows } = await db.query<{ key: string }>(
            `SELECT key FROM public.kv_store
             WHERE key LIKE $1
               AND (expires_at IS NULL OR expires_at > now())`,
            [sqlPat]
        );
        return rows.map((r) => r.key);
    },

    // ── mget ─────────────────────────────────────────────────────────────────

    async mget<T extends unknown[] = unknown[]>(
        ...keys: string[]
    ): Promise<(T[number] | null)[]> {
        if (keys.length === 0) return [];
        const db = pool();
        const { rows } = await db.query<{ key: string; value: unknown }>(
            `SELECT key, value FROM public.kv_store
             WHERE key = ANY($1::text[])
               AND (expires_at IS NULL OR expires_at > now())`,
            [keys]
        );
        const map = new Map(rows.map((r) => [r.key, r.value]));
        return keys.map((k) => (map.has(k) ? (map.get(k) as T[number]) : null));
    },

    // ── hgetall ──────────────────────────────────────────────────────────────

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        // Hashes are stored as JSON objects in the value column — same as get.
        return this.get<T>(key);
    },

    // ── hset ─────────────────────────────────────────────────────────────────

    async hset(key: string, fields: Record<string, unknown>): Promise<number> {
        const db = pool();
        // kv_hset atomically merges new fields into the existing JSON object.
        await db.query(
            `SELECT public.kv_hset($1, $2::jsonb)`,
            [key, JSON.stringify(fields)]
        );
        return Object.keys(fields).length;
    },

    // ── hdel ─────────────────────────────────────────────────────────────────

    async hdel(key: string, ...fields: string[]): Promise<number> {
        if (fields.length === 0) return 0;
        const db = pool();
        await db.query(
            `SELECT public.kv_hdel($1, $2::text[])`,
            [key, fields]
        );
        return fields.length;
    },
};
