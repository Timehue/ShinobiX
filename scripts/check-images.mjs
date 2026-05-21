import pg from 'pg';
const { Client } = pg;
const client = new Client({
    connectionString: 'postgres://postgres.soaychxshtbgwujhytsf:OAYhs28XnzW3z8Pn@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require',
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
