"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _war_map_sectors_js_1 = require("../_war-map-sectors.js");
const _war_state_js_1 = require("../_war-state.js");
/*
 * /api/village/war-terrain — POST only
 *
 * Set a home sector's terrain (the +10% jutsu-school defender buff, §17.3). The
 * seated Kage may set 3 sectors, each ANBU elder 1 (quota in canSetTerrain).
 * Admin acts as Kage. Server-gated: 404 unless ENABLE_VILLAGE_WAR=1.
 * Body: { playerName, village, sector, terrain }.
 */
const VILLAGE_STATE_PREFIX = 'game:village-state:';
function kageKey(village) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1')
        return res.status(404).json({ error: 'Not found.' });
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const sector = Math.floor(Number(body.sector) || 0);
        const terrain = String(body.terrain ?? '');
        if (!playerName || !village)
            return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
            return res.status(400).json({ error: 'Not a war village.' });
        if (!_war_state_js_1.TERRAINS.includes(terrain))
            return res.status(400).json({ error: 'Unknown terrain.' });
        if ((0, _war_map_sectors_js_1.homeVillageForSector)(sector) !== village)
            return res.status(400).json({ error: 'That sector is not one of your home sectors.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-war-terrain', 30, 60_000, identity.name)))
            return;
        // Determine the actor's terrain-setting role (Kage 3 / elder 1; admin = Kage).
        let role = 'none';
        if (identity.admin) {
            role = 'kage';
        }
        else {
            const [kageState, vs] = await Promise.all([
                _storage_js_1.kv.get(kageKey(village)),
                _storage_js_1.kv.get(`${VILLAGE_STATE_PREFIX}${(0, _war_state_js_1.villageWarSlug)(village)}`),
            ]);
            const anbu = Array.isArray(vs?.anbuAppointees) ? vs.anbuAppointees.map((n) => (0, _utils_js_1.safeName)(String(n))) : [];
            if ((0, _utils_js_1.safeName)(kageState?.seatedKage ?? '') === playerName)
                role = 'kage';
            else if (anbu.includes(playerName))
                role = 'elder';
        }
        if (role === 'none') {
            return res.status(403).json({ error: 'Only the seated Kage or an elder (ANBU) can set sector terrain.' });
        }
        const warKey = (0, _war_state_js_1.villageWarKey)(village);
        const result = await (0, _lock_js_1.withKvLock)(warKey, async () => {
            const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get(warKey)) ?? undefined);
            const gate = (0, _war_state_js_1.canSetTerrain)(record, sector, playerName, role);
            if (!gate.ok)
                return { ok: false, error: gate.error };
            record.sectors[String(sector)].terrain = terrain;
            record.terrainSetBy[String(sector)] = playerName;
            await _storage_js_1.kv.set(warKey, record);
            return { ok: true, sector, terrain, role };
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
    }
    catch (err) {
        console.error('[village/war-terrain]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
