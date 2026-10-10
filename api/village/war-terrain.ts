import { readVillageElders } from './_elders.js';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage } from '../_war-map-sectors.js';
import { heldSectorListForVillage } from '../_war-held-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    villageWarSlug,
    canSetTerrain,
    reconcileTerrainLeadership,
    sectorConfigFor,
    TERRAINS,
    type TerrainRole,
    type Terrain,
} from '../_war-state.js';
import { villageWarMapEnabled } from '../_release-flags.js';

/*
 * /api/village/war-terrain — POST only
 *
 * Set the terrain (the +10% jutsu-school defender buff, §17.3) of a sector the
 * village HOLDS right now, home or captured: the current holder sets a sector's
 * rules, and a lost sector frees its pick (owner ruling 2026-10-08). The seated
 * Kage may set 3 sectors, each current Elder 1 (quota in canSetTerrain, counted
 * over the sectors held). Admin acts as Kage. Server-gated by the default-on
 * Sector Map campaign switch.
 * Body: { playerName, village, sector, terrain }.
 */

const VILLAGE_STATE_PREFIX = 'game:village-state:';
function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const sector = Math.floor(Number(body.sector) || 0);
        const terrain = String(body.terrain ?? '') as Terrain;
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
        if (!(TERRAINS as readonly string[]).includes(terrain)) return res.status(400).json({ error: 'Unknown terrain.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-terrain', 30, 60_000, identity.name))) return;

        return await withKvLock(kageKey(village), () => withKvLock(`${VILLAGE_STATE_PREFIX}${villageWarSlug(village)}`, async () => {
            const [kageState, elderSeats, save] = await Promise.all([
                kv.get<{ seatedKage?: string }>(kageKey(village)),
                readVillageElders(village),
                kv.get<{ character?: { village?: string } }>(`save:${playerName}`),
            ]);
            if (!identity.admin && save?.character?.village !== village) return res.status(403).json({ error: 'You must belong to this village.' });
            const seatedKage = safeName(kageState?.seatedKage ?? '');
            const elders = elderSeats.map(safeName).filter(Boolean);
            const role: TerrainRole = identity.admin || seatedKage === playerName ? 'kage'
                : elders.includes(playerName) ? 'elder' : 'none';
            if (role === 'none') {
                return res.status(403).json({ error: 'Only the seated Kage or a current Elder can set sector terrain.' });
            }
            // The sector must be one this village holds right now.
            const held = await heldSectorListForVillage(village);
            if (!held.includes(sector)) {
                return res.status(400).json({ error: 'Your village does not hold that sector. Its holder sets its terrain.' });
            }

            const warKey = villageWarKey(village);
            const result = await withKvLock(warKey, async () => {
                const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
                reconcileTerrainLeadership(record, seatedKage, elders, held);
                const gate = canSetTerrain(record, sector, playerName, role, held);
                if (!gate.ok) return { ok: false as const, error: gate.error };
                record.sectors[String(sector)] = { ...sectorConfigFor(record, sector), terrain };
                record.terrainSetBy[String(sector)] = playerName;
                await kv.set(warKey, record);
                return { ok: true as const, sector, terrain, role };
            }, { failClosed: true });

            if (!result.ok) {
                const msg = result.error === 'quota-reached'
                    ? (role === 'kage' ? 'You have already set terrain on 3 of the sectors you hold.' : 'Elders may set terrain on 1 of the sectors you hold.')
                    : result.error === 'set-by-another'
                        ? 'Another leader already set this sector\'s terrain.'
                        : 'Cannot set terrain on that sector.';
                return res.status(409).json({ error: msg });
            }
            return res.status(200).json(result);
        }, { failClosed: true }), { failClosed: true });
    } catch (err) {
        console.error('[village/war-terrain]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
