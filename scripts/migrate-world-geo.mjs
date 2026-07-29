/*
 * One-off KV migration for the 2026-07 world renumbering (shared/sector-geo.ts).
 *
 * Remaps the durable sector-numbered keys:
 *   world:territory:<oldSector>  →  world:territory:<newSector>
 * (record's embedded `sector` field remapped too, record stamped geoV=2).
 *
 * Everything else is safe by design:
 *   - save:* records self-migrate on read (api/_elapsed-state.ts settleSaveRecord)
 *   - rift seals self-migrate at parse (api/sector/_rift-quest.ts, geoV stamp)
 *   - world:footfall:* (48h) and world:trail-signs:* (72h) expire on their own
 *   - world:shrine:* keys are string ids, untouched by the renumbering
 * Active world:war:* records are listed as a warning — finish or reset wars
 * around the deploy instead of migrating mid-war state.
 *
 * Usage (from repo root, with the production env available):
 *   node --import tsx --env-file=.env scripts/migrate-world-geo.mjs           # dry run
 *   node --import tsx --env-file=.env scripts/migrate-world-geo.mjs --apply   # write
 *
 * Idempotent: records stamped geoV>=2 are skipped, so re-running is safe.
 */
import { kv } from '../api/_storage.js';
import { OLD_TO_NEW_SECTOR, WORLD_GEO_VERSION } from '../shared/sector-geo.js';

const APPLY = process.argv.includes('--apply');
const PREFIX = 'world:territory:';

function sectorOfKey(key) {
    const raw = key.slice(PREFIX.length);
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

const keys = await kv.keys(`${PREFIX}*`);
console.log(`[migrate-world-geo] ${keys.length} territory key(s) found${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

let migrated = 0;
let skipped = 0;
for (const key of keys.sort()) {
    const oldSector = sectorOfKey(key);
    if (oldSector == null) { console.log(`  ?? ${key} — unparseable sector, skipped`); skipped++; continue; }
    const record = await kv.get(key);
    if (!record || typeof record !== 'object') { console.log(`  -- ${key} — empty, skipped`); skipped++; continue; }
    if (Number(record.geoV ?? 0) >= WORLD_GEO_VERSION) { console.log(`  == ${key} — already geoV ${record.geoV}, skipped`); skipped++; continue; }

    const newSector = OLD_TO_NEW_SECTOR[oldSector];
    if (!newSector) { console.log(`  ?? ${key} — no mapping for sector ${oldSector}, skipped`); skipped++; continue; }
    const newKey = `${PREFIX}${newSector}`;

    const existingAtTarget = await kv.get(newKey);
    if (existingAtTarget && Number(existingAtTarget.geoV ?? 0) >= WORLD_GEO_VERSION) {
        console.log(`  !! ${key} — target ${newKey} already migrated, source left for manual review`);
        skipped++;
        continue;
    }

    const next = { ...record, geoV: WORLD_GEO_VERSION };
    if (Number.isInteger(Number(next.sector))) next.sector = newSector;
    console.log(`  -> ${key} => ${newKey} (owner ${record.ownerClan ?? record.ownerVillage ?? 'unknown'})`);
    if (APPLY) {
        await kv.set(newKey, next);
        if (newKey !== key) await kv.del(key);
    }
    migrated++;
}

const wars = await kv.keys('world:war:*');
if (wars.length) {
    console.log(`[migrate-world-geo] WARNING: ${wars.length} active world:war:* record(s) — they embed pre-reorg sector numbers.`);
    console.log('  Finish or reset these wars around the deploy; this script deliberately does not rewrite mid-war state:');
    for (const w of wars) console.log(`    ${w}`);
}

console.log(`[migrate-world-geo] done: ${migrated} migrated, ${skipped} skipped${APPLY ? '' : ' (dry run)'}`);
