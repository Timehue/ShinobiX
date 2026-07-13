"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
(0, node_test_1.describe)('Supabase KV schema hardening', () => {
    const schema = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'supabase-schema.sql'), 'utf8');
    (0, node_test_1.it)('keeps mutating KV RPC functions off the anonymous Data API', () => {
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
            strict_1.default.match(schema, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`, 'i'), `${signature} must not remain callable by browser Data API roles`);
            strict_1.default.match(schema, new RegExp(`grant execute on function public\\.${escaped} to service_role;`, 'i'), `${signature} must remain available to the trusted server role`);
        }
    });
    (0, node_test_1.it)('preserves the narrow Realtime-only anonymous table policy', () => {
        strict_1.default.match(schema, /create policy "kv_store_anon_select"/i);
        strict_1.default.match(schema, /key like 'pvp:%'/i);
        strict_1.default.match(schema, /revoke all\s+on public\.kv_store from authenticated;/i);
    });
});
