/*
 * Resolve a caller's VILLAGE without reading their save blob.
 *
 * WHY THIS EXISTS (perf, 100-200 concurrent players on one Railway process):
 * two hot per-viewer GETs — /api/village/intel and /api/village/war-map — used
 * to do `kv.get('save:<name>')` purely to read `character.village`, a single
 * short string. A save record is the fattest row in the store: it carries the
 * base64 `avatarImage` data URL (see api/_utils.ts) plus inventory, jutsu and
 * pets, so that one-string lookup pulled ~200 KB out of Postgres and JSON.parse'd
 * it. Worse, on /api/village/intel it happened BEFORE the proc-cache memo, so
 * the shared-frame cache could not absorb it: every single request paid it.
 * At the intel endpoint's real cadence that measured out at ~21 full-save reads
 * per second (~4 MB/s of egress + parse) on the one process that also serves
 * combat, PvP and presence — enough to starve the connection pool and drive GC
 * pressure long before request COUNT became the limit.
 *
 * WHY IT READS THE SAVE, NOT PRESENCE: this used to answer from the live
 * presence row first, at zero KV cost. But presence `character` is
 * CLIENT-SUPPLIED (the heartbeat stores whatever the client sends), and since
 * the owner's 2026-10-08 ruling a village's intel, war chest, structures, stores
 * and treasury are for its MEMBERS only. Every caller here now decides whose
 * internals a response may carry, which is authorization: a player who claimed
 * another village in their heartbeat would have been served that village's
 * internals. So the answer comes from the SAVE, as a database-side projection
 * (api/_storage-projection.ts): only `character.village` leaves Postgres, a few
 * bytes instead of the ~200 KB row, which keeps the perf fix above.
 *
 * Read-only: the projected value is never written back or cached as a save.
 */
import { kv } from './_storage.js';
import { readKvProjection } from './_storage-projection.js';
import { safeName } from './_utils.js';

/**
 * A player's village, as their SAVE records it — the membership authority for
 * members-only views. '' for an unknown, villageless or unusable name.
 * Never a request body — the caller passes the authenticated identity name.
 */
export async function viewerVillageOf(playerName: string): Promise<string> {
    const name = safeName(String(playerName ?? ''));
    if (!name) return '';
    const [row] = await readKvProjection(kv, [`save:${name}`], { village: ['character', 'village'] });
    const village = row?.village;
    return typeof village === 'string' ? village.trim() : '';
}
