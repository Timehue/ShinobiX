// Supabase Realtime client + helpers for subscribing to changes on
// individual rows in the kv_store table. Used by PvpBattleScreen and
// ClanWarTileCardDuel to get push-based session state updates with
// ~50-80ms latency, replacing the server-side SSE polling loop.
//
// Falls back gracefully when env vars aren't set: realtimeAvailable()
// returns false and consumers should use their SSE/polling path.
//
// Required env vars (set in Vercel → Project Settings → Env Vars):
//   VITE_SUPABASE_URL        — your project URL
//   VITE_SUPABASE_ANON_KEY   — your anon (public) key
//
// Required Supabase config:
//   1. Database → Replication → enable for `kv_store` table
//   2. SQL editor — add an RLS policy for anon SELECT on the keys you
//      want clients to read:
//        CREATE POLICY "anon_read_pvp_realtime"
//        ON kv_store FOR SELECT TO anon
//        USING (key LIKE 'pvp:%' OR key LIKE 'cw-tilecards:%');

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _initialized = false;

function getEnv(name: string): string {
    // Vite exposes import.meta.env.VITE_* at build time.
    const v = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
    return typeof v === 'string' ? v : '';
}

function init(): SupabaseClient | null {
    if (_initialized) return _client;
    _initialized = true;
    const url = getEnv('VITE_SUPABASE_URL');
    const key = getEnv('VITE_SUPABASE_ANON_KEY');
    if (!url || !key) {
        // No-op when env vars aren't set — consumers fall back to SSE.
        return null;
    }
    try {
        _client = createClient(url, key, {
            // Don't try to maintain auth session — we use the anon key
            // for read-only Realtime subscriptions, no user auth here.
            auth: { persistSession: false, autoRefreshToken: false },
            realtime: {
                // Cap the heartbeat at 30s — Supabase default is fine
                // but explicit is safer in case defaults change.
                heartbeatIntervalMs: 30_000,
            },
        });
        return _client;
    } catch {
        return null;
    }
}

export function realtimeAvailable(): boolean {
    return init() !== null;
}

// Subscribe to changes on a single kv_store row (by exact key match).
// Returns an unsubscribe function. The callback fires with the new
// `value` JSON whenever the row is INSERTed or UPDATEd.
//
// Returns null when Realtime isn't configured — caller should use
// SSE / polling fallback.
export function subscribeKvKey<T = unknown>(
    key: string,
    onChange: (value: T) => void,
): (() => void) | null {
    const client = init();
    if (!client) return null;

    // Channel names should be unique per subscription so we don't
    // collide with other subscribers on the same client.
    const channelName = `kv:${key}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = client
        .channel(channelName)
        .on(
            'postgres_changes',
            {
                event: '*',         // INSERT or UPDATE
                schema: 'public',
                table: 'kv_store',
                filter: `key=eq.${key}`,
            },
            (payload) => {
                const newRow = (payload as { new?: { value?: T } }).new;
                if (newRow && newRow.value !== undefined) {
                    try { onChange(newRow.value as T); } catch { /* ignore */ }
                }
            },
        )
        .subscribe();

    return () => {
        try { client.removeChannel(channel); } catch { /* ignore */ }
    };
}
