import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { normalizeVillageWarRecord, villageWarKey, villageWarSlug } from '../_war-state.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { villageWarMapView, type VillageWarMapView } from '../_war-map-view.js';
import { listActiveSectorWars } from '../_sector-war-store.js';

/*
 * /api/village/war-map — GET only. The read-only War-Map aggregator (Phase 6).
 *
 * The client's War-Map command panel reuses /api/world-state for sector
 * ownership + village wars, and this for the WR-economy layer world-state doesn't
 * carry: each war village's WR + treasury-seal pools, its 6 structures + daily
 * upkeep + dormancy, the Supply-Depot WR rate, the effective tax tier (from how
 * many sectors it currently holds), each home sector's win-condition / terrain /
 * Control-HP cap, plus every active sector-war contest. View-only — all actions
 * call the dedicated server-auth endpoints.
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1. Requires a logged-in player.
 */

const TERRITORY_KEY_PREFIX = 'world:territory:';
const VILLAGE_STATE_PREFIX = 'game:village-state:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const [warRaws, stateRaws, contests, territoryKeys] = await Promise.all([
            Promise.all(WAR_VILLAGES.map((v) => kv.get<Record<string, unknown>>(villageWarKey(v)))),
            Promise.all(WAR_VILLAGES.map((v) => kv.get<Record<string, unknown>>(`${VILLAGE_STATE_PREFIX}${villageWarSlug(v)}`))),
            listActiveSectorWars(),
            kv.keys(`${TERRITORY_KEY_PREFIX}*`),
        ]);

        // Server-authoritative held-sector count per village (mirrors the
        // territory scan in api/village/claim-map-control.ts) → drives the tax tier.
        const territories = territoryKeys.length
            ? ((await kv.mget<Record<string, unknown>[]>(...territoryKeys)).filter(Boolean) as Record<string, unknown>[])
            : [];
        const heldCount: Record<string, number> = {};
        for (const t of territories) {
            const owner = String(t.ownerVillage ?? '').trim();
            if (owner) heldCount[owner] = (heldCount[owner] ?? 0) + 1;
        }

        const villages: VillageWarMapView[] = WAR_VILLAGES.map((v, i) => {
            const record = normalizeVillageWarRecord(v, warRaws[i] ?? undefined);
            const treasury = (stateRaws[i]?.treasury ?? {}) as Record<string, unknown>;
            const treasurySeals = Number(treasury.honorSeals) || 0;
            return villageWarMapView({ village: v, record, treasurySeals, sectorsHeld: heldCount[v] ?? 0 });
        });

        return res.status(200).json({ ok: true, enabled: true, villages, contests });
    } catch (err) {
        console.error('[village/war-map]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
