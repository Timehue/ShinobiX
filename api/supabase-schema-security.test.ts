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

    it('preserves the narrow Realtime-only anonymous table policy', () => {
        assert.match(schema, /create policy "kv_store_anon_select"/i);
        assert.match(schema, /key like 'pvp:%'/i);
        assert.match(schema, /revoke all\s+on public\.kv_store from authenticated;/i);
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
