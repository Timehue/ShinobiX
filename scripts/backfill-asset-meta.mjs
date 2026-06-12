// One-off backfill for the asset-metadata registry (Priority 6).
//
// The registry fills in lazily as images are (re)uploaded, so this script is
// OPTIONAL — run it once if you want metadata for assets that already exist and
// haven't been touched since the registry shipped. It is idempotent and
// additive: it only writes `asset:meta:<id>` companion records, never touches
// the image bytes (`shared:img:*` / the category hashes) and never deletes.
//
// Run with tsx so it can import the TS helpers directly (no build needed), with
// the storage env configured the same way the server uses it:
//   PowerShell:
//     $env:DATABASE_URL = "postgres://...pooler.supabase.com:5432/postgres?sslmode=require"
//     node --import tsx scripts/backfill-asset-meta.mjs --dry-run
//     node --import tsx scripts/backfill-asset-meta.mjs            # write missing
//     node --import tsx scripts/backfill-asset-meta.mjs --force    # also rewrite existing
//   bash:
//     DATABASE_URL="postgres://..." node --import tsx scripts/backfill-asset-meta.mjs --dry-run
//
// Flags:
//   --dry-run   report what would be written, write nothing
//   --force     rewrite metadata even if an asset:meta record already exists
//   --limit N   stop after N image keys (smoke-test a small batch first)

import { kv } from '../api/_storage.ts';
import { buildAssetMeta, assetMetaKey } from '../api/_asset-registry.ts';
import { categoryFromId } from '../api/images.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) || Infinity : Infinity;

const PREFIX = 'shared:img:';

async function main() {
    const keys = await kv.keys(`${PREFIX}*`);
    console.log(`backfill-asset-meta: found ${keys.length} per-image keys${dryRun ? ' (DRY RUN)' : ''}${force ? ' (FORCE)' : ''}`);

    let written = 0, skippedExisting = 0, skippedBad = 0, processed = 0;
    const now = Date.now();

    for (const key of keys) {
        if (processed >= limit) break;
        processed += 1;
        const id = key.slice(PREFIX.length);
        const image = await kv.get(key);
        if (typeof image !== 'string' || !image) { skippedBad += 1; continue; }

        const existing = await kv.get(assetMetaKey(id));
        if (existing && !force) { skippedExisting += 1; continue; }

        const meta = buildAssetMeta({
            id,
            category: categoryFromId(id),
            image,
            actor: 'backfill',
            now,
            prev: existing ?? undefined,
        });
        if (!dryRun) await kv.set(assetMetaKey(id), meta);
        written += 1;
        if (written % 100 === 0) console.log(`  …${written} written`);
    }

    console.log(
        `backfill-asset-meta: done — ${written} ${dryRun ? 'would be written' : 'written'}, ` +
        `${skippedExisting} skipped (already had metadata), ${skippedBad} skipped (no/invalid image).`,
    );
}

main().then(() => process.exit(0)).catch((err) => {
    console.error('backfill-asset-meta failed:', err);
    process.exit(1);
});
