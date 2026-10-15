// Wrap every dormant legacy password hash in scrypt, without knowing any password.
//
// A legacy `auth:<name>` row stores bare HMAC-SHA256(salt, password): billions of
// guesses a second on a GPU if the database or a backup ever leaks. Login already
// upgrades a row the moment its owner signs in, but an account nobody has touched
// since the scrypt switch keeps the fast hash forever. This rewrites each such row
// as `scrypt-hmac:N:r:p:hex` = scrypt(that HMAC), which api/player-auth.ts
// verifies by recomputing the HMAC from the typed password first. The player sees
// nothing; their next login turns it into plain scrypt.
//
// Dry run by default. Each write is a compare-and-set on the exact row it read, so
// a login or password change that lands meanwhile wins and the row is skipped.
//
//   node --import tsx scripts/wrap-legacy-password-hashes.mjs           # report only
//   node --import tsx scripts/wrap-legacy-password-hashes.mjs --apply   # rewrite
//
// Needs DATABASE_URL. Touches only `auth:%` rows still in the legacy format, so it
// is a handful of small UPDATEs, not a table rewrite.
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { wrapLegacyPasswordHash } from '../api/player-auth.ts';

const LEGACY_HEX = /^[0-9a-f]{64}$/;

export function isLegacyAuthRecord(value) {
    return !!value && typeof value === 'object'
        && typeof value.hash === 'string' && typeof value.salt === 'string'
        && LEGACY_HEX.test(value.hash);
}

async function main() {
    const apply = process.argv.includes('--apply');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required.');
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
        const { rows } = await client.query("select key, value from public.kv_store where key like 'auth:%'");
        const legacy = rows.filter((row) => isLegacyAuthRecord(row.value));
        console.log(`[wrap-legacy] ${rows.length} auth rows, ${legacy.length} still on the legacy hash.`);
        if (!apply) {
            console.log('[wrap-legacy] Dry run. Re-run with --apply to rewrite them.');
            return;
        }
        let wrapped = 0;
        let skipped = 0;
        for (const row of legacy) {
            const next = { ...row.value, hash: await wrapLegacyPasswordHash(row.value.hash, row.value.salt) };
            const result = await client.query(
                'update public.kv_store set value = $3::jsonb, updated_at = now() where key = $1 and value = $2::jsonb',
                [row.key, JSON.stringify(row.value), JSON.stringify(next)],
            );
            if (result.rowCount === 1) wrapped += 1;
            else skipped += 1;
        }
        console.log(`[wrap-legacy] Wrapped ${wrapped}; skipped ${skipped} that changed while running.`);
    } finally {
        await client.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error('[wrap-legacy]', err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    });
}
