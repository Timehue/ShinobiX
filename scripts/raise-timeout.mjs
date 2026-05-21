#!/usr/bin/env node
// Raise the Postgres statement_timeout for the service_role so the Supabase
// REST API can serve large image blobs without hitting the default 8-second cap.
import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: process.env.SUPABASE_POSTGRES_URL_NON_POOLING,
    ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log('Connected ✓');

// 120 seconds — enough for any blob we store.
await client.query(`ALTER ROLE service_role SET statement_timeout = '120s'`);
console.log('service_role statement_timeout → 120s ✓');

// Also set for authenticator (the PostgREST connection role).
try {
    await client.query(`ALTER ROLE authenticator SET statement_timeout = '120s'`);
    console.log('authenticator statement_timeout → 120s ✓');
} catch (e) {
    console.log('authenticator alter skipped (may need superuser):', e.message);
}

await client.end();
console.log('Done.');
