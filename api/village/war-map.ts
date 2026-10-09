import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { normalizeVillageWarRecord, villageWarKey, villageWarSlug } from '../_war-state.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { loadHeldSectors } from '../_war-held-sectors.js';
import { isVillageKageSeated } from '../_war-tax-apply.js';
import { publicVillageWarMapView, villageWarMapView, type VillageWarMapPublicView, type VillageWarMapView } from '../_war-map-view.js';
import { listActiveSectorWars } from '../_sector-war-store.js';
import { projectSectorWarForClient } from '../_sector-war.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import { viewerVillageOf } from '../_viewer-village.js';

/*
 * /api/village/war-map — GET only. The read-only War-Map aggregator (Phase 6).
 *
 * The client's War-Map command panel reuses /api/world-state for sector
 * ownership + village wars, and this for the WR-economy layer world-state doesn't
 * carry. For the VIEWER's own village: its WR + treasury-seal pools, its 6
 * structures + daily upkeep + dormancy, the Supply-Depot WR rate, the effective
 * tax tier, its stores and their ledger. For every village: the sectors it holds
 * and their win-condition / terrain (the holder sets them). Another village's
 * internals are for its members only (owner ruling 2026-10-08). Plus every
 * active sector-war contest, with only the viewer's own garrison feed.
 * View-only — all actions call the dedicated server-auth endpoints.
 *
 * Server-gated by the default-on Sector Map campaign switch. Requires a logged-in player.
 */

const TERRITORY_KEY_PREFIX = 'world:territory:';
const VILLAGE_STATE_PREFIX = 'game:village-state:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

    // Per-VIEWER by construction: `projectSectorWarForClient(c, viewerVillage)`
    // below emits the caller's own garrison-feed mirror, so two villages get
    // different bytes from the same URL. server.ts notes Cloudflare caches some
    // GETs and this handler set NO Cache-Control at all, which left the response
    // eligible for a shared cache — one village's projection could have been
    // served to another. Match /api/village/intel: never shared, never stored.
    res.setHeader('Cache-Control', 'private, no-store');

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        // Held-sector counts come from the SHARED helper (api/_war-held-sectors.ts)
        // that the daily WR faucet and the comeback discount also read, so the count
        // this screen displays can never drift from the one the server charges on.
        // The same scan also says WHICH sectors each village holds: each sector
        // is listed under its holder, with the holder's settings (owner ruling
        // 2026-10-08).
        const [warRaws, stateRaws, contests, { counts: heldCount, lists: heldLists }, kageSeats, resolvedViewerVillage] = await Promise.all([
            Promise.all(WAR_VILLAGES.map((v) => kv.get<Record<string, unknown>>(villageWarKey(v)))),
            Promise.all(WAR_VILLAGES.map((v) => kv.get<Record<string, unknown>>(`${VILLAGE_STATE_PREFIX}${villageWarSlug(v)}`))),
            listActiveSectorWars(),
            loadHeldSectors(),
            // The seat drives the tax rate (no Kage → 0%), so it has to be read here
            // too or the displayed rate would diverge from the charged one.
            Promise.all(WAR_VILLAGES.map((v) => isVillageKageSeated(v))),
            // The viewer's village drives the contest projection's compatibility
            // `garrisonFed*` mirror (their OWN per-village feed entry only).
            // Presence-first (api/_viewer-village.ts): this used to `kv.get` the
            // caller's whole save — base64 avatar, inventory, jutsu and all — to
            // read one short string. The live presence row already carries
            // `village`, so an online caller now costs zero KV reads here.
            identity.admin ? Promise.resolve('') : viewerVillageOf(identity.name),
        ]);
        const viewerVillage = resolvedViewerVillage || undefined;

        // A village's war chest, structures, stores and tax are for its own
        // members (owner ruling 2026-10-08). Everyone else gets the public view:
        // who holds what, and the rules of each held sector. Admins see all.
        const villages: Array<VillageWarMapView | VillageWarMapPublicView> = WAR_VILLAGES.map((v, i) => {
            const record = normalizeVillageWarRecord(v, warRaws[i] ?? undefined);
            const treasury = (stateRaws[i]?.treasury ?? {}) as Record<string, unknown>;
            const treasurySeals = Number(treasury.honorSeals) || 0;
            const view = villageWarMapView({
                village: v, record, treasurySeals, sectorsHeld: heldCount[v] ?? 0, kageSeated: kageSeats[i],
                provisions: Number(treasury.provisions) || 0, materialPoints: Number(treasury.materialPoints) || 0,
                heldSectors: heldLists[v] ?? [],
            });
            return identity.admin || v === viewerVillage ? view : publicVillageWarMapView(view);
        });

        return res.status(200).json({
            ok: true, enabled: true, villages,
            contests: contests.map((c) => projectSectorWarForClient(c, viewerVillage, { admin: identity.admin })),
        });
    } catch (err) {
        console.error('[village/war-map]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
