import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Supabase KV schema hardening', () => {
    const schema = readFileSync(join(process.cwd(), 'supabase-schema.sql'), 'utf8');

    it('keeps mutating KV RPC functions off the anonymous Data API', () => {
        for (const signature of [
            'kv_set_nx(text, jsonb, timestamptz)',
            'kv_incr(text, timestamptz)',
            'kv_hset(text, jsonb)',
            'kv_hdel(text, text[])',
            'kv_delete_expired()',
        ]) {
            const escaped = signature
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/ /g, '\\s+');
            assert.match(
                schema,
                new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`, 'i'),
                `${signature} must not remain callable by browser Data API roles`,
            );
            assert.match(
                schema,
                new RegExp(`grant execute on function public\\.${escaped} to service_role;`, 'i'),
                `${signature} must remain available to the trusted server role`,
            );
            assert.match(
                schema,
                new RegExp(`grant execute on function public\\.${escaped} to shinobix_app;`, 'i'),
                `${signature} must remain available to the game's login role`,
            );
        }
    });

    it('keeps the KV functions SECURITY INVOKER', () => {
        assert.doesNotMatch(schema, /^\s*security\s+definer\b/im, 'a definer function would reach kv_store for any caller');
    });

    it('keeps the game login role limited to kv_store', () => {
        assert.match(schema, /grant select, insert, update, delete on public\.kv_store to shinobix_app;/i);
        assert.doesNotMatch(schema, /grant\s+(all|[a-z, ]*truncate)[a-z, ]*\s+on public\.kv_store to\s+shinobix_app/i);
        assert.doesNotMatch(schema, /create\s+role\s+shinobix_app[^;]*password/i, 'the password must never live in this file');
    });

    it('never drops the game login policy, so re-running the file cannot lock the game out', () => {
        assert.match(schema, /create policy "shinobix_app_all"/i);
        assert.match(schema, /policyname = 'shinobix_app_all'/i, 'the policy must be created only when missing');
        assert.doesNotMatch(schema, /drop\s+policy\s+(if\s+exists\s+)?"shinobix_app_all"/i);
    });

    it('gives the browser roles no access to kv_store (the Realtime-only read is retired)', () => {
        // 2026-10-12: nothing subscribes over Supabase Realtime, so the anon
        // `pvp:%` read policy and grant were dropped; RLS stays on.
        assert.match(schema, /alter table public\.kv_store enable row level security;/i);
        assert.match(schema, /drop policy if exists "kv_store_anon_select"\s+on public\.kv_store;/i);
        assert.doesNotMatch(schema, /create policy "kv_store_anon_select"/i, 'no anon read policy may come back');
        assert.doesNotMatch(schema, /grant\s+select\s+on public\.kv_store to\s+anon/i, 'no anon table grant may come back');
        assert.match(schema, /revoke all\s+on public\.kv_store from anon;/i);
        assert.match(schema, /revoke all\s+on public\.kv_store from authenticated;/i);
        assert.match(schema, /alter publication supabase_realtime drop table public\.kv_store;/i);
    });

    it('does NOT expose the per-player challenge inbox to the anon role', () => {
        // challenges:* was removed from BOTH the anon SELECT allowlist and the
        // Realtime publication filter (2026-07-17). The browser never subscribed
        // to it — challenges arrive over the authenticated heartbeat + Socket.IO —
        // so the grant only let the public anon key enumerate every player's
        // (projected) challenge inbox. Do not re-add it.
        assert.doesNotMatch(schema, /key like 'challenges:%'/i, 'challenges:* must not be anon-readable');
    });
});
