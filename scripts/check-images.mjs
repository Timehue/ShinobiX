import pg from 'pg';
const { Client } = pg;

// The connection string (with the DB password) comes from the environment —
// never hardcode it. Fail closed if it's missing so a misconfigured run can't
// silently fall back to a baked-in credential.
//   PowerShell:  $env:DATABASE_URL = "postgres://...:<pw>@...pooler.supabase.com:5432/postgres?sslmode=require"; node scripts/check-images.mjs
//   bash:        DATABASE_URL="postgres://..." node scripts/check-images.mjs
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('check-images: set DATABASE_URL (Supabase pooler connection string) before running.');
    process.exit(1);
}
const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
});
await client.connect();

const keys = [
    'shared:images',
    'shared:images:jutsu',
    'shared:images:item',
    'shared:images:misc',
    'shared:imgfields:jutsu',
    'shared:imgfields:avatar',
    'shared:imgfields:event',
];
for (const key of keys) {
    const r = await client.query(
        `SELECT length(value::text) as bytes,
                (SELECT count(*) FROM jsonb_object_keys(value)) as field_count
         FROM kv_store WHERE key = $1`,
        [key]
    );
    if (r.rows.length === 0) {
        console.log(key, '-> NOT FOUND');
    } else {
        const { bytes, field_count } = r.rows[0];
        console.log(key, `-> ${(bytes/1024).toFixed(0)} KB, ${field_count} fields`);
    }
}
await client.end();
