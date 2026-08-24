import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { viewerVillageOf } from '../_viewer-village.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cachedFor } from '../_proc-cache.js';
import { villageStoresEnabled } from '../_release-flags.js';
import { villageWarSlug, type StructureKey } from '../_war-state.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { listActiveSectorWars } from '../_sector-war-store.js';
import type { SectorWarSession } from '../_sector-war.js';
import { readAllSectorPoolUsage, type SectorPoolRow } from '../world/_sector-pool.js';
import {
    buildVillageIntelView,
    readAllVillageIntel,
    readVillageStructureLevels,
    type VillageIntelRow,
    type VillageIntelView,
} from '../_village-intel.js';

/*
 * /api/village/intel — GET only. The per-viewer Village Stores INTEL block.
 *
 * WHY IT IS NOT ON /api/world-state: intel is per-VIEWER (what your village has
 * scouted, and who has been scouting you), so attaching it to the shared world
 * poll forced that response to `private, no-store`. Every logged-in client's
 * fetch carries auth (shinobij.client/src/authFetch.ts patches window.fetch for
 * all /api/ URLs), so in practice EVERY world-state poll became uncacheable —
 * ~7-13 origin requests/second at the 100-200 concurrent-player cap, where the
 * `s-maxage=12` CDN cache had been collapsing them to roughly one per 12s. This
 * endpoint carries the per-viewer half on its own slow cadence instead, and
 * world-state went back to being a shared, publicly cacheable document.
 *
 * Response (identical block to the one world-state used to inline):
 *   200 { ok: true, enabled: true,  villageIntel: {
 *           village, thresholds: { scouted, mapped, infiltrated },
 *           revealed: [{ sector, points, tier, expiresAt, owner,
 *                        revealed: { garrison, poolUsage, structures } }],
 *           scoutedBy: { [sector]: [{ village, tier, points }] } } }
 *   200 { ok: true, enabled: false, villageIntel: null }   kill switch off
 *   200 { ok: true, enabled: true,  villageIntel: null }   admin / no village
 *   401 unauthenticated · 405 non-GET · 429 rate limited · 500 storage error
 *
 * `revealed` only ever lists sectors this village holds >= 100 intel points on
 * (tier `scouted`+), and `scoutedBy` only ever lists sectors this village OWNS —
 * both enforced in the shared builder (api/_village-intel.ts), which is the same
 * code the old inline path used. No logic is duplicated here.
 *
 * Cost shape: the heavy half (four keyspace reads) is built at most once per
 * PROC_FRAME_MS across all viewers via api/_proc-cache.ts single-flight, and the
 * finished per-village view is memoised for the same window — so N players in
 * one village cost one build, not N. The response itself is `private, no-store`:
 * it is per-viewer by construction and must never reach a shared cache.
 */

const TERRITORY_KEY_PREFIX = 'world:territory:';
/** Shared-read + per-village-view memo window. Well under the client's 30-60s poll. */
const PROC_FRAME_MS = 5_000;

type IntelFrame = {
    ownerBySector: Record<string, string | undefined>;
    allIntel: Record<string, VillageIntelRow>;
    contests: SectorWarSession[];
    structuresByVillageSlug: Record<string, Record<StructureKey, number>>;
    sectorPools: Record<number, SectorPoolRow>;
};

/*
 * Sector → owning village, from the authoritative territory rows.
 *
 * NOT shared with api/world-state.ts's `world-state:frame` proc-cache entry,
 * deliberately. Three reasons, in order of weight:
 *  1. That entry stores a POSITIONAL 4-tuple built by a private helper in a file
 *     this module must not couple to; a reorder there would silently mis-read
 *     ownership here (wrong village on a reveal) rather than fail loudly.
 *  2. Its territory slice comes from `getByPrefix`, which returns VALUES ONLY —
 *     the key is dropped. This reader needs sector→owner and recovers the sector
 *     from the KEY when a legacy/unseeded row carries no embedded `sector` field
 *     (see the `?? key.slice(...)` fallback below). Rebuilding from that tuple
 *     would drop exactly those rows, turning a revealed sector's `owner` null.
 *  3. Joining that cache key from here would make an intel poll TRIGGER
 *     world-state's full build on a miss — 4 keyspace scans instead of this 1 —
 *     a regression at intel's slower cadence, not a saving.
 * The residual duplicate is small and bounded: one scan per PROC_FRAME_MS across
 * ALL viewers (≤0.2 scans/s) over ~40 rows, versus the ~21 full-save reads/s the
 * presence-first village resolve removed. Collapsing the two properly means
 * extracting a shared territory reader that world-state.ts also calls, which is
 * an edit to a file this task does not own.
 */
async function readOwnerBySector(): Promise<Record<string, string | undefined>> {
    const keys = await kv.keys(`${TERRITORY_KEY_PREFIX}*`);
    if (!keys.length) return {};
    const values = await kv.mget<Record<string, unknown>[]>(...keys);
    const out: Record<string, string | undefined> = {};
    keys.forEach((key, i) => {
        const row = values[i];
        if (!row) return;
        const sector = Math.floor(Number(row.sector ?? key.slice(TERRITORY_KEY_PREFIX.length)));
        if (!Number.isFinite(sector) || sector <= 0) return;
        out[String(sector)] = String(row.ownerVillage ?? '').trim() || undefined;
    });
    return out;
}

/** Every read the view needs, built once per frame for ALL viewers. */
function readIntelFrame(now: number): Promise<IntelFrame> {
    return cachedFor('village-intel:frame', PROC_FRAME_MS, async () => {
        const [ownerBySector, allIntel, contests, structuresByVillageSlug, sectorPools] = await Promise.all([
            readOwnerBySector(),
            readAllVillageIntel(now),
            listActiveSectorWars(),
            readVillageStructureLevels(WAR_VILLAGES),
            readAllSectorPoolUsage(now).catch(() => ({} as Record<number, SectorPoolRow>)),
        ]);
        return { ownerBySector, allIntel, contests, structuresByVillageSlug, sectorPools };
    });
}

/** The finished block for one village. Memoised per village for the same window. */
export function buildVillageIntelResponse(village: string, now: number = Date.now()): Promise<VillageIntelView> {
    const slug = villageWarSlug(village);
    return cachedFor(`village-intel:view:${slug}`, PROC_FRAME_MS, async () => {
        const frame = await readIntelFrame(now);
        return buildVillageIntelView({ viewerVillage: village, ...frame, now });
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Per-viewer by construction — never let a shared cache hold one village's reveals.
    res.setHeader('Cache-Control', 'private, no-store');

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-intel', 30, 60_000, identity.name))) return;

    // Kill switch: an explicit disabled block, not a 404, so the client can tell
    // "campaign off" from "endpoint broken" and simply renders no intel plate.
    if (!villageStoresEnabled()) {
        return res.status(200).json({ ok: true, enabled: false, villageIntel: null });
    }

    try {
        // Admins have no village of their own, so there is no viewer to build for.
        // Presence-first (api/_viewer-village.ts): this resolve sits OUTSIDE the
        // proc-cache memo below, so it is the ONE cost every request pays. Reading
        // it from the in-memory presence row instead of `save:<name>` is what keeps
        // that per-request cost at zero KV reads for an online player.
        const village = identity.admin ? '' : await viewerVillageOf(identity.name);
        if (!village) return res.status(200).json({ ok: true, enabled: true, villageIntel: null });
        const villageIntel = await buildVillageIntelResponse(village, Date.now());
        return res.status(200).json({ ok: true, enabled: true, villageIntel });
    } catch (err) {
        console.error('[village/intel]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
