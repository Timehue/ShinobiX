#!/usr/bin/env node
/**
 * Import keys from a local upstash-backup-*.json file into Supabase kv_store.
 * Does not touch Upstash at all — reads the backup written by the migration script.
 *
 * Usage:
 *   node scripts/import-from-backup.mjs [backup-file.json]
 *   (defaults to the most-recent upstash-backup-*.json in cwd)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UPSERT_BATCH = 100;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

// Find backup file.
let backupFile = process.argv[2];
if (!backupFile) {
    const files = readdirSync('.').filter((f) => f.startsWith('upstash-backup-') && f.endsWith('.json'));
    if (files.length === 0) {
        console.error('No upstash-backup-*.json file found in current directory.');
        process.exit(1);
    }
    files.sort();
    backupFile = files[files.length - 1]; // most recent
}

console.log(`\n📂  Reading backup: ${backupFile}`);
const backup = JSON.parse(readFileSync(backupFile, 'utf8'));
const keys = Object.keys(backup);
console.log(`    ${keys.length} keys found.\n`);

if (keys.length === 0) {
    console.log('Nothing to import.');
    process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

function ttlToExpiresAt(ttl) {
    if (!ttl || ttl <= 0) return null;
    return new Date(Date.now() + ttl * 1000).toISOString();
}

// Build upsert rows.
const rows = keys.map((key) => {
    const { value, ttl } = backup[key];
    return {
        key,
        value,
        expires_at: ttlToExpiresAt(ttl),
        updated_at: new Date().toISOString(),
    };
});

console.log(`📦  Upserting ${rows.length} rows into Supabase…`);

let upserted = 0;
let errored  = 0;

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

console.log(`\n\n✅  Import complete.`);
console.log(`    Rows upserted: ${upserted}`);
console.log(`    Errors:        ${errored}\n`);

if (errored > 0) process.exit(1);
