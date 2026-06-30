import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage, homeVillageForSector } from '../_war-map-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    villageWarSlug,
    canSetTerrain,
    TERRAINS,
    type TerrainRole,
    type Terrain,
} from '../_war-state.js';

/*
 * /api/village/war-terrain — POST only
 *
 * Set a home sector's terrain (the +10% jutsu-school defender buff, §17.3). The
 * seated Kage may set 3 sectors, each ANBU elder 1 (quota in canSetTerrain).
 * Admin acts as Kage. Server-gated: 404 unless ENABLE_VILLAGE_WAR=1.
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
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const sector = Math.floor(Number(body.sector) || 0);
        const terrain = String(body.terrain ?? '') as Terrain;
        if (!playerName || !village) return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
        if (!(TERRAINS as readonly string[]).includes(terrain)) return res.status(400).json({ error: 'Unknown terrain.' });
        if (homeVillageForSector(sector) !== village) return res.status(400).json({ error: 'That sector is not one of your home sectors.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-war-terrain', 30, 60_000, identity.name))) return;

        // Determine the actor's terrain-setting role (Kage 3 / elder 1; admin = Kage).
        let role: TerrainRole = 'none';
        if (identity.admin) {
            role = 'kage';
        } else {
            const [kageState, vs] = await Promise.all([
                kv.get<{ seatedKage?: string }>(kageKey(village)),
                kv.get<{ anbuAppointees?: unknown }>(`${VILLAGE_STATE_PREFIX}${villageWarSlug(village)}`),
            ]);
            const anbu = Array.isArray(vs?.anbuAppointees) ? vs!.anbuAppointees.map((n) => safeName(String(n))) : [];
            if (safeName(kageState?.seatedKage ?? '') === playerName) role = 'kage';
            else if (anbu.includes(playerName)) role = 'elder';
        }
        if (role === 'none') {
            return res.status(403).json({ error: 'Only the seated Kage or an elder (ANBU) can set sector terrain.' });
        }

        const warKey = villageWarKey(village);
        const result = await withKvLock(warKey, async () => {
            const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(warKey)) ?? undefined);
            const gate = canSetTerrain(record, sector, playerName, role);
            if (!gate.ok) return { ok: false as const, error: gate.error };
            record.sectors[String(sector)].terrain = terrain;
            record.terrainSetBy[String(sector)] = playerName;
            await kv.set(warKey, record);
            return { ok: true as const, sector, terrain, role };
        }, { failClosed: true });

        if (!result.ok) {
            const msg = result.error === 'quota-reached'
                ? (role === 'kage' ? 'You have already set terrain on 3 sectors.' : 'Elders may set terrain on 1 sector.')
                : result.error === 'set-by-another'
                    ? 'Another leader already set this sector\'s terrain.'
                    : 'Cannot set terrain on that sector.';
            return res.status(409).json({ error: msg });
        }
        return res.status(200).json(result);
    } catch (err) {
        console.error('[village/war-terrain]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
