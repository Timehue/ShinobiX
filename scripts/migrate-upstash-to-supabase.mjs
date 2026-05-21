#!/usr/bin/env node
/**
 * Migrate all Upstash Redis keys to Supabase kv_store.
 *
 * Usage (PowerShell):
 *   $env:UPSTASH_REDIS_REST_URL   = "https://..."
 *   $env:UPSTASH_REDIS_REST_TOKEN = "..."
 *   $env:SUPABASE_URL             = "https://soaychxshtbgwujhytsf.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY= "eyJ..."
 *   $env:KEY_PATTERN              = "*"        # optional, default *
 *   node scripts\migrate-upstash-to-supabase.mjs
 *
 * What it does:
 *   1. SCAN all Upstash keys matching KEY_PATTERN.
 *   2. For each key: determine TYPE, read value (GET or HGETALL), read TTL.
 *   3. Upsert each key into Supabase kv_store.
 *   4. Write a local backup file (upstash-backup-YYYY-MM-DD.json).
 *
 * Supported Redis types: string, hash.
 * Skipped types: list, set, zset (logged as warnings).
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ─── Config ──────────────────────────────────────────────────────────────────

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY_PATTERN   = process.env.KEY_PATTERN ?? '*';
const BATCH_SIZE    = 50;    // keys per pipeline batch
const UPSERT_BATCH  = 100;   // rows per Supabase upsert

if (!UPSTASH_URL || !UPSTASH_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
        'Missing environment variables. Need:\n' +
        '  UPSTASH_REDIS_REST_URL\n' +
        '  UPSTASH_REDIS_REST_TOKEN\n' +
        '  SUPABASE_URL\n' +
        '  SUPABASE_SERVICE_ROLE_KEY'
    );
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Upstash helpers ─────────────────────────────────────────────────────────

async function upstashCmd(...args) {
    const res = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${UPSTASH_TOKEN}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.error) throw new Error(`Upstash error: ${json.error}`);
    return json.result;
}

async function upstashPipeline(commands) {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${UPSTASH_TOKEN}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash pipeline HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    // Pipeline returns an array of { result } | { error }
    return json.map((item) => {
        if (item.error) throw new Error(`Pipeline error: ${item.error}`);
        return item.result;
    });
}

/** Scan all keys matching pattern, returns full list. */
async function scanAllKeys(pattern) {
    const keys = [];
    let cursor = '0';
    do {
        const result = await upstashCmd('SCAN', cursor, 'MATCH', pattern, 'COUNT', '200');
        cursor = String(result[0]);
        keys.push(...result[1]);
    } while (cursor !== '0');
    return keys;
}

/** Try to parse a string as JSON; return the parsed value or the raw string. */
function maybeParseJson(str) {
    if (typeof str !== 'string') return str;
    try {
        return JSON.parse(str);
    } catch {
        return str;
    }
}

/** Convert a Redis TTL (-2=gone, -1=no expiry, N=seconds) to ISO string or null. */
function ttlToExpiresAt(ttl) {
    if (ttl <= 0) return null;   // -2 = key gone (shouldn't happen), -1 = no expiry
    return new Date(Date.now() + ttl * 1000).toISOString();
}

// ─── Migration ───────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🔍  Scanning Upstash keys matching "${KEY_PATTERN}"…`);
    const allKeys = await scanAllKeys(KEY_PATTERN);
    console.log(`    Found ${allKeys.length} keys.\n`);

    if (allKeys.length === 0) {
        console.log('Nothing to migrate.');
        return;
    }

    const backup = {};          // key → { type, value, ttl }
    const rows = [];            // Supabase upsert rows
    let skipped = 0;
    let errored = 0;

    // Process keys in batches using pipeline.
    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
        const batch = allKeys.slice(i, i + BATCH_SIZE);

        // Step 1: get TYPE and TTL for each key in one pipeline round-trip.
        const typeTtlCmds = batch.flatMap((k) => [
            ['TYPE', k],
            ['TTL',  k],
        ]);
        let typeTtlResults;
        try {
            typeTtlResults = await upstashPipeline(typeTtlCmds);
        } catch (err) {
            console.error(`Batch ${i}–${i + batch.length} TYPE/TTL error: ${err.message}`);
            errored += batch.length;
            continue;
        }

        // Split results into [type, ttl] pairs.
        const meta = batch.map((k, idx) => ({
            key: k,
            type: typeTtlResults[idx * 2],
            ttl:  typeTtlResults[idx * 2 + 1],
        }));

        // Separate string vs hash keys; skip unsupported types.
        const stringKeys = meta.filter((m) => m.type === 'string');
        const hashKeys   = meta.filter((m) => m.type === 'hash');
        const skipKeys   = meta.filter((m) => m.type !== 'string' && m.type !== 'hash');

        if (skipKeys.length > 0) {
            for (const { key, type } of skipKeys) {
                console.warn(`  ⚠ Skipping key "${key}" (unsupported type: ${type})`);
                skipped++;
            }
        }

        // Step 2a: GET all string values.
        if (stringKeys.length > 0) {
            let getResults;
            try {
                getResults = await upstashPipeline(stringKeys.map(({ key }) => ['GET', key]));
            } catch (err) {
                console.error(`Batch GET error: ${err.message}`);
                errored += stringKeys.length;
                stringKeys.length = 0; // clear so we skip below
            }

            for (let j = 0; j < stringKeys.length; j++) {
                const { key, ttl } = stringKeys[j];
                const raw = getResults[j];
                const value = maybeParseJson(raw);
                backup[key] = { type: 'string', value, ttl };
                rows.push({
                    key,
                    value,
                    expires_at: ttlToExpiresAt(ttl),
                    updated_at: new Date().toISOString(),
                });
            }
        }

        // Step 2b: HGETALL all hash values.
        if (hashKeys.length > 0) {
            let hgetallResults;
            try {
                hgetallResults = await upstashPipeline(hashKeys.map(({ key }) => ['HGETALL', key]));
            } catch (err) {
                console.error(`Batch HGETALL error: ${err.message}`);
                errored += hashKeys.length;
                hashKeys.length = 0;
            }

            for (let j = 0; j < hashKeys.length; j++) {
                const { key, ttl } = hashKeys[j];
                const flat = hgetallResults[j]; // ["field1", "val1", "field2", "val2", ...]
                // Convert flat array to object.
                const obj = {};
                if (Array.isArray(flat)) {
                    for (let k = 0; k < flat.length; k += 2) {
                        obj[flat[k]] = maybeParseJson(flat[k + 1]);
                    }
                }
                backup[key] = { type: 'hash', value: obj, ttl };
                rows.push({
                    key,
                    value: obj,
                    expires_at: ttlToExpiresAt(ttl),
                    updated_at: new Date().toISOString(),
                });
            }
        }

        const done = Math.min(i + BATCH_SIZE, allKeys.length);
        process.stdout.write(`\r    Processed ${done}/${allKeys.length} keys…`);
    }

    console.log(`\n\n📦  Upserting ${rows.length} rows into Supabase…`);

    // Upsert to Supabase in batches.
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

    // Write backup file.
    const date = new Date().toISOString().slice(0, 10);
    const backupPath = `upstash-backup-${date}.json`;
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

    console.log(`\n\n✅  Migration complete.`);
    console.log(`    Keys found:    ${allKeys.length}`);
    console.log(`    Rows upserted: ${upserted}`);
    console.log(`    Skipped:       ${skipped}  (unsupported Redis types)`);
    console.log(`    Errors:        ${errored}`);
    console.log(`    Backup file:   ${backupPath}\n`);

    if (errored > 0) {
        console.warn(`⚠  Some keys failed. Review errors above and re-run if needed.`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
});
