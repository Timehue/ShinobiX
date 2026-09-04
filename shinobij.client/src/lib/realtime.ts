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
//   2. SQL editor — run supabase-schema.sql (idempotent). It enables RLS
//      on kv_store and creates an anon SELECT policy that allows reads
//      on the prefixes this client subscribes to:
//        pvp:*           — PvP session state
//      Anything else stays invisible to the browser.
//      Removed grants — do NOT re-add either:
//        challenges:*    — App.tsx used to subscribe here for a low-latency push,
//                          but the row is not per-viewer safe and challenges
//                          already arrive over the authenticated heartbeat +
//                          Socket.IO nudge, so the subscription was dropped and
//                          the grant removed (2026-07-17 / re-confirmed 2026-07-23).
//        cw-tilecards:*  — the raw Chronicle showdown row holds both decks, both
//                          hands, and every face-down card; only the
//                          authenticated handler's per-viewer projection is
//                          safe to expose. Removed 2026-07-23 (P0).
//
// A record that needs per-viewer redaction can never be Realtime-subscribed
// directly: RLS is row-level and the browser would receive the raw `value`.
// Publish a revision-counter key instead and refetch the projection over HTTP.
//
// To add a new realtime-subscribed prefix: update supabase-schema.sql's
// SELECT policy AND this comment, then re-run the schema file.

import { RealtimeClient } from '@supabase/realtime-js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

let _client: RealtimeClient | null = null;
let _initialized = false;

function init(): RealtimeClient | null {
    if (_initialized) return _client;
    _initialized = true;
    const url = SUPABASE_URL;
    const key = SUPABASE_ANON_KEY;
    if (!url || !key) {
        // No-op when env vars aren't set — consumers fall back to SSE.
        return null;
    }
    try {
        const realtimeUrl = new URL('realtime/v1', `${url.replace(/\/+$/, '')}/`);
        realtimeUrl.protocol = realtimeUrl.protocol.replace(/^http/, 'ws');
        _client = new RealtimeClient(realtimeUrl.href, {
            // This adapter uses only read-only Realtime. Depending on the
            // standalone client avoids shipping Auth, Storage, Functions, and
            // PostgREST clients that are never called in the browser.
            params: { apikey: key },
            // Mirror SupabaseClient's anonymous access-token callback so
            // Realtime RLS receives the same JWT in each channel join payload.
            accessToken: async () => key,
            // Cap the heartbeat at 30s — Supabase default is fine but explicit
            // is safer in case defaults change.
            heartbeatIntervalMs: 30_000,
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
// Status forwarded from Supabase's channel.subscribe callback. Consumers
// can use this to render a "reconnecting..." indicator when the
// WebSocket drops mid-session.
export type RealtimeChannelStatus =
    | 'SUBSCRIBED'
    | 'CLOSED'
    | 'CHANNEL_ERROR'
    | 'TIMED_OUT';

export function subscribeKvKey<T = unknown>(
    key: string,
    onChange: (value: T) => void,
    onStatus?: (status: RealtimeChannelStatus) => void,
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
        .subscribe((status) => {
            if (!onStatus) return;
            try { onStatus(status as RealtimeChannelStatus); } catch { /* ignore */ }
        });

    return () => {
        try { void client.removeChannel(channel).catch(() => undefined); } catch { /* ignore */ }
    };
}
