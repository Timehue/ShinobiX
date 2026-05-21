#!/usr/bin/env node
/**
 * Migrate all Upstash Redis keys to Supabase kv_store.
 * Uses ioredis (wire protocol) instead of the Upstash REST API,
 * which has a separate 500 K/month command cap.
 *
 * Usage (PowerShell — inline env vars):
 *   node scripts/migrate-upstash-ioredis.mjs
 *   (set KV_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY beforehand)
 *
 * Or pass inline:
 *   $env:KV_URL="rediss://default:TOKEN@host:6379"
 *   $env:SUPABASE_URL="https://xxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   node scripts/migrate-upstash-ioredis.mjs
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';

// ─── Config ──────────────────────────────────────────────────────────────────

const KV_URL        = process.env.KV_URL;          // rediss://default:TOKEN@host:6379
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY_PATTERN   = process.env.KEY_PATTERN ?? '*';
const BATCH_SIZE    = 50;   // keys per pipeline round-trip
const UPSERT_BATCH  = 100;  // rows per Supabase upsert

if (!KV_URL || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
        'Missing environment variables. Need:\n' +
        '  KV_URL                    (rediss://default:TOKEN@host:6379)\n' +
        '  SUPABASE_URL\n' +
        '  SUPABASE_SERVICE_ROLE_KEY'
    );
    process.exit(1);
}

// ─── Clients ─────────────────────────────────────────────────────────────────

const redis = new Redis(KV_URL, {
    tls: {},          // Upstash uses TLS; ioredis needs this for rediss://
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
});

redis.on('error', (err) => {
    // Don't crash on transient errors — ioredis retries automatically.
    console.error('[redis error]', err.message);
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Try to parse JSON; return raw string on failure. */
function maybeParseJson(str) {
    if (typeof str !== 'string') return str;
    try { return JSON.parse(str); } catch { return str; }
}

/** Convert Redis TTL (seconds, -1=no expiry, -2=gone) to ISO string or null. */
function ttlToExpiresAt(ttl) {
    if (!ttl || ttl <= 0) return null;
    return new Date(Date.now() + ttl * 1000).toISOString();
}

/** Scan all keys matching pattern, returns full array. */
async function scanAllKeys(pattern) {
    const keys = [];
    let cursor = '0';
    do {
        // SCAN cursor MATCH pattern COUNT 200
        const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '200');
        cursor = nextCursor;
        keys.push(...batch);
    } while (cursor !== '0');
    return keys;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🔍  Connecting to Upstash via ioredis…`);
    // Trigger a connection check.
    await redis.ping();
    console.log(`    Connected ✓`);

    console.log(`\n🔍  Scanning keys matching "${KEY_PATTERN}"…`);
    const allKeys = await scanAllKeys(KEY_PATTERN);
    console.log(`    Found ${allKeys.length} keys.\n`);

    if (allKeys.length === 0) {
        console.log('Nothing to migrate.');
        await redis.quit();
        return;
    }

    const backup = {};     // key → { type, value, ttl }
    const rows   = [];     // Supabase upsert rows
    let skipped  = 0;
    let errored  = 0;

    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
        const batch = allKeys.slice(i, i + BATCH_SIZE);

        // Step 1: pipeline TYPE + TTL for every key in the batch.
        const typeTtlPipeline = redis.pipeline();
        for (const key of batch) {
            typeTtlPipeline.type(key);
            typeTtlPipeline.ttl(key);
        }
        let typeTtlResults;
        try {
            typeTtlResults = await typeTtlPipeline.exec();
        } catch (err) {
            console.error(`\nBatch ${i} TYPE/TTL pipeline error: ${err.message}`);
            errored += batch.length;
            continue;
        }

        // typeTtlResults is an array of [err, value] pairs (ioredis pipeline format).
        const meta = batch.map((key, idx) => ({
            key,
            type: typeTtlResults[idx * 2][1],
            ttl:  typeTtlResults[idx * 2 + 1][1],
        }));

        const stringKeys = meta.filter((m) => m.type === 'string');
        const hashKeys   = meta.filter((m) => m.type === 'hash');
        const skipKeys   = meta.filter((m) => m.type !== 'string' && m.type !== 'hash');

        for (const { key, type } of skipKeys) {
            console.warn(`  ⚠ Skipping "${key}" (type: ${type})`);
            skipped++;
        }

        // Step 2a: GET all string keys.
        if (stringKeys.length > 0) {
            const getPipeline = redis.pipeline();
            for (const { key } of stringKeys) getPipeline.get(key);
            let getResults;
            try {
                getResults = await getPipeline.exec();
            } catch (err) {
                console.error(`\nBatch GET pipeline error: ${err.message}`);
                errored += stringKeys.length;
                stringKeys.length = 0;
            }

            if (getResults) {
                for (let j = 0; j < stringKeys.length; j++) {
                    const { key, ttl } = stringKeys[j];
                    const raw = getResults[j][1];
                    const value = maybeParseJson(raw);
                    backup[key] = { type: 'string', value, ttl };
                    rows.push({ key, value, expires_at: ttlToExpiresAt(ttl), updated_at: new Date().toISOString() });
                }
            }
        }

        // Step 2b: HGETALL all hash keys.
        if (hashKeys.length > 0) {
            const hPipeline = redis.pipeline();
            for (const { key } of hashKeys) hPipeline.hgetall(key);
            let hResults;
            try {
                hResults = await hPipeline.exec();
            } catch (err) {
                console.error(`\nBatch HGETALL pipeline error: ${err.message}`);
                errored += hashKeys.length;
                hashKeys.length = 0;
            }

            if (hResults) {
                for (let j = 0; j < hashKeys.length; j++) {
                    const { key, ttl } = hashKeys[j];
                    const flat = hResults[j][1]; // ioredis HGETALL returns an object already
                    // Parse any JSON-encoded field values.
                    const obj = {};
                    for (const [field, val] of Object.entries(flat ?? {})) {
                        obj[field] = maybeParseJson(val);
                    }
                    backup[key] = { type: 'hash', value: obj, ttl };
                    rows.push({ key, value: obj, expires_at: ttlToExpiresAt(ttl), updated_at: new Date().toISOString() });
                }
            }
        }

        const done = Math.min(i + BATCH_SIZE, allKeys.length);
        process.stdout.write(`\r    Processed ${done}/${allKeys.length} keys…`);
    }

    console.log(`\n\n📦  Upserting ${rows.length} rows into Supabase…`);

    let upserted = 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const batch = rows.slice(i, i + UPSERT_BATCH);
        const { error } = await supabase
            .from('kv_store')
            .upsert(batch, { onConflict: 'key' });
        if (error) {
            console.error(`\nSupabase upsert error (rows ${i}–${i + batch.length}): ${error.message}`);
            errored += batch.length;
        } else {
            upserted += batch.length;
        }
        process.stdout.write(`\r    Upserted ${Math.min(i + UPSERT_BATCH, rows.length)}/${rows.length} rows…`);
    }

    // Write local backup.
    const date = new Date().toISOString().slice(0, 10);
    const backupPath = `upstash-backup-${date}.json`;
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

    console.log(`\n\n✅  Migration complete.`);
    console.log(`    Keys found:    ${allKeys.length}`);
    console.log(`    Rows upserted: ${upserted}`);
    console.log(`    Skipped:       ${skipped}  (unsupported Redis types)`);
    console.log(`    Errors:        ${errored}`);
    console.log(`    Backup:        ${backupPath}\n`);

    await redis.quit();

    if (errored > 0) {
        console.warn(`⚠  Some keys failed. Review errors above and re-run if needed.`);
        process.exit(1);
    }
}

main().catch(async (err) => {
    console.error('\n❌ Fatal error:', err);
    try { await redis.quit(); } catch {}
    process.exit(1);
});
