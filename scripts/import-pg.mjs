#!/usr/bin/env node
/**
 * Import upstash-backup-*.json into Supabase via direct Postgres connection.
 * Bypasses the Supabase REST API statement timeout — safe for large image rows.
 */

import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const PG_URL   = process.env.SUPABASE_POSTGRES_URL_NON_POOLING;
const BATCH    = 20; // rows per parameterised INSERT

if (!PG_URL) {
    console.error('Missing SUPABASE_POSTGRES_URL_NON_POOLING');
    process.exit(1);
}

// Find backup file.
let backupFile = process.argv[2];
if (!backupFile) {
    const files = readdirSync('.').filter((f) => f.startsWith('upstash-backup-') && f.endsWith('.json'));
    if (!files.length) { console.error('No upstash-backup-*.json found.'); process.exit(1); }
    files.sort();
    backupFile = files[files.length - 1];
}

console.log(`\n📂  Reading backup: ${backupFile}`);
const backup = JSON.parse(readFileSync(backupFile, 'utf8'));
const entries = Object.entries(backup); // [[key, {type,value,ttl}], ...]
console.log(`    ${entries.length} keys found.\n`);

if (!entries.length) { console.log('Nothing to import.'); process.exit(0); }

// Build rows.
function ttlToExpiry(ttl) {
    if (!ttl || ttl <= 0) return null;
    return new Date(Date.now() + ttl * 1000).toISOString();
}
const rows = entries.map(([key, { value, ttl }]) => ({
    key,
    value: JSON.stringify(value),   // store as JSONB text
    expires_at: ttlToExpiry(ttl),
    updated_at: new Date().toISOString(),
}));

console.log(`🔌  Connecting to Postgres…`);
const client = new Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`    Connected ✓\n`);

// Set a generous statement timeout (10 minutes) for large image rows.
await client.query(`SET statement_timeout = '600000'`);

let upserted = 0;
let errored  = 0;

console.log(`📦  Upserting ${rows.length} rows…`);
for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // Build a multi-row parameterised upsert.
    const values = [];
    const params = [];
    batch.forEach((row, idx) => {
        const base = idx * 4;
        values.push(`($${base+1}, $${base+2}::jsonb, $${base+3}::timestamptz, $${base+4}::timestamptz)`);
        params.push(row.key, row.value, row.expires_at, row.updated_at);
    });
    const sql = `
        INSERT INTO public.kv_store (key, value, expires_at, updated_at)
        VALUES ${values.join(', ')}
        ON CONFLICT (key) DO UPDATE
            SET value      = EXCLUDED.value,
                expires_at = EXCLUDED.expires_at,
                updated_at = EXCLUDED.updated_at
    `;
    try {
        await client.query(sql, params);
        upserted += batch.length;
    } catch (err) {
        console.error(`\nBatch ${i}–${i+batch.length} error: ${err.message}`);
        // Fall back to row-by-row for this batch.
        for (const row of batch) {
            try {
                await client.query(`
                    INSERT INTO public.kv_store (key, value, expires_at, updated_at)
                    VALUES ($1, $2::jsonb, $3::timestamptz, $4::timestamptz)
                    ON CONFLICT (key) DO UPDATE
                        SET value      = EXCLUDED.value,
                            expires_at = EXCLUDED.expires_at,
                            updated_at = EXCLUDED.updated_at
                `, [row.key, row.value, row.expires_at, row.updated_at]);
                upserted++;
            } catch (rowErr) {
                console.error(`  ✗ "${row.key}": ${rowErr.message}`);
                errored++;
            }
        }
    }
    process.stdout.write(`\r    ${Math.min(i + BATCH, rows.length)}/${rows.length} rows…`);
}

await client.end();

console.log(`\n\n✅  Import complete.`);
console.log(`    Rows upserted: ${upserted}`);
console.log(`    Errors:        ${errored}\n`);
if (errored > 0) process.exit(1);
