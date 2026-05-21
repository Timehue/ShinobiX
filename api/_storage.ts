/**
 * Supabase KV adapter — drop-in replacement for @vercel/kv.
 *
 * Storage model:
 *   Each key is one row in public.kv_store.
 *   String values  → value column holds the JSON-encoded payload.
 *   Hash values    → value column holds a JSON object; hset merges fields
 *                    atomically via the kv_hset SQL function.
 *   TTL            → stored in expires_at (timestamptz); lazily evicted on
 *                    read, and periodically by kv_delete_expired().
 *
 * Only the methods actually used by the app are implemented:
 *   get / set / del / keys / mget / hgetall / hset / hdel
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Supabase client (singleton, initialised once) ───────────────────────────

let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.'
        );
    }
    _client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return _client;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a Redis-style glob pattern to a SQL LIKE pattern. */
function toSqlPattern(pattern: string): string {
    // Escape existing SQL special chars first, then map glob wildcards.
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

/** True if an expires_at value is in the past. */
function isExpired(exp: string | null): boolean {
    if (!exp) return false;
    return new Date(exp) <= new Date();
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const kv = {
    // ── get ──────────────────────────────────────────────────────────────────

    async get<T = unknown>(key: string): Promise<T | null> {
        const db = client();
        const { data, error } = await db
            .from('kv_store')
            .select('value, expires_at')
            .eq('key', key)
            .maybeSingle();

        if (error) throw new Error(`kv.get(${key}): ${error.message}`);
        if (!data) return null;

        if (isExpired(data.expires_at as string | null)) {
            // Lazy delete — fire-and-forget.
            void db.from('kv_store').delete().eq('key', key);
            return null;
        }

        return data.value as T;
    },

    // ── set ──────────────────────────────────────────────────────────────────

    async set(
        key: string,
        value: unknown,
        options?: { ex?: number; nx?: boolean }
    ): Promise<'OK' | null> {
        const db = client();
        const exp = options?.ex ? expiresAt(options.ex) : null;

        if (options?.nx) {
            // Atomic set-if-not-exists via database function.
            const { data, error } = await db.rpc('kv_set_nx', {
                p_key: key,
                p_value: value,
                p_expires_at: exp,
            });
            if (error) throw new Error(`kv.set NX(${key}): ${error.message}`);
            return data ? 'OK' : null;
        }

        const { error } = await db.from('kv_store').upsert(
            {
                key,
                value,
                expires_at: exp,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'key' }
        );
        if (error) throw new Error(`kv.set(${key}): ${error.message}`);
        return 'OK';
    },

    // ── del ──────────────────────────────────────────────────────────────────

    async del(...keys: string[]): Promise<number> {
        if (keys.length === 0) return 0;
        const db = client();
        const { count, error } = await db
            .from('kv_store')
            .delete({ count: 'exact' })
            .in('key', keys);
        if (error) throw new Error(`kv.del: ${error.message}`);
        return count ?? 0;
    },

    // ── keys ─────────────────────────────────────────────────────────────────

    async keys(pattern: string): Promise<string[]> {
        const db = client();
        const sqlPat = toSqlPattern(pattern);
        const now = new Date().toISOString();

        // PostgREST OR syntax: "expires_at.is.null,expires_at.gt.<iso>"
        const { data, error } = await db
            .from('kv_store')
            .select('key')
            .like('key', sqlPat)
            .or(`expires_at.is.null,expires_at.gt.${now}`);

        if (error) throw new Error(`kv.keys(${pattern}): ${error.message}`);
        return (data ?? []).map((row: { key: string }) => row.key);
    },

    // ── mget ─────────────────────────────────────────────────────────────────

    async mget<T extends unknown[] = unknown[]>(
        ...keys: string[]
    ): Promise<(T[number] | null)[]> {
        if (keys.length === 0) return [];
        const db = client();
        const now = new Date().toISOString();

        const { data, error } = await db
            .from('kv_store')
            .select('key, value')
            .in('key', keys)
            .or(`expires_at.is.null,expires_at.gt.${now}`);

        if (error) throw new Error(`kv.mget: ${error.message}`);

        const map = new Map(
            (data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value])
        );
        return keys.map((k) => (map.has(k) ? (map.get(k) as T[number]) : null));
    },

    // ── hgetall ──────────────────────────────────────────────────────────────

    async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
        // Hashes are stored as JSON objects in the value column.
        return this.get<T>(key);
    },

    // ── hset ─────────────────────────────────────────────────────────────────

    async hset(key: string, fields: Record<string, unknown>): Promise<number> {
        const db = client();
        // kv_hset is an atomic SQL function that does:
        //   INSERT ... ON CONFLICT DO UPDATE SET value = value || excluded.value
        // This merges the new fields into the existing JSON object.
        const { error } = await db.rpc('kv_hset', {
            p_key: key,
            p_fields: fields,
        });
        if (error) {
            // Fallback: read-modify-write (acceptable for low-concurrency paths).
            console.warn(`kv.hset RPC failed, using fallback: ${error.message}`);
            const existing =
                (await this.get<Record<string, unknown>>(key)) ?? {};
            await this.set(key, { ...existing, ...fields });
        }
        return Object.keys(fields).length;
    },

    // ── hdel ─────────────────────────────────────────────────────────────────

    async hdel(key: string, ...fields: string[]): Promise<number> {
        if (fields.length === 0) return 0;
        const db = client();
        // kv_hdel atomically removes specific JSON object keys.
        const { error } = await db.rpc('kv_hdel', {
            p_key: key,
            p_fields: fields,
        });
        if (error) {
            // Fallback.
            console.warn(`kv.hdel RPC failed, using fallback: ${error.message}`);
            const existing =
                (await this.get<Record<string, unknown>>(key)) ?? {};
            for (const f of fields) delete existing[f];
            await this.set(key, existing);
        }
        return fields.length;
    },
};
