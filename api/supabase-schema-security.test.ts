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
        }
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
