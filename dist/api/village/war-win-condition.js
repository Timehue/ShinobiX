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
 * /api/village/war-win-condition — POST only
 *
 * The seated Kage (or admin) sets a single home sector's sector-war win-condition
 * (Combat / Card). Enforces the max-7-per-type diversity rule (§17.2) via
 * canAssignWinCondition. Pet is rejected until its server-authoritative sim is
 * wired (Phase 7) — a client-claimed pet result must never flip territory.
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 (inert until launch).
 * Body: { playerName, village, sector, winCondition }.
 */
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
        const winCondition = String(body.winCondition ?? '');
        if (!playerName || !village)
            return res.status(400).json({ error: 'Missing playerName or village.' });
        if (!(0, _war_map_sectors_js_1.isWarVillage)(village))
            return res.status(400).json({ error: 'Not a war village.' });
        if (!_war_state_js_1.WIN_CONDITIONS.includes(winCondition)) {
            return res.status(400).json({ error: 'Unknown win-condition.' });
        }
        // Pet sector wars require the server-side sim (Phase 7); until then a
        // client-claimed pet result could flip territory — disallow assigning it.
        if (winCondition === 'pet') {
            return res.status(409).json({ error: 'Pet-battle sectors are not available yet.' });
        }
        // The sector must be a home sector of this village.
        if ((0, _war_map_sectors_js_1.homeVillageForSector)(sector) !== village) {
            return res.status(400).json({ error: 'That sector is not one of your home sectors.' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-war-wincondition', 30, 60_000, identity.name)))
            return;
        if (!identity.admin) {
            const kageState = await _storage_js_1.kv.get(kageKey(village));
            if ((0, _utils_js_1.safeName)(kageState?.seatedKage ?? '') !== playerName) {
                return res.status(403).json({ error: 'Only the seated Kage can set sector win-conditions.' });
            }
        }
        const warKey = (0, _war_state_js_1.villageWarKey)(village);
        const result = await (0, _lock_js_1.withKvLock)(warKey, async () => {
            const record = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get(warKey)) ?? undefined);
            if (!(0, _war_state_js_1.canAssignWinCondition)(record, sector, winCondition)) {
                return { ok: false, error: 'max-7' };
            }
            record.sectors[String(sector)].winCondition = winCondition;
            await _storage_js_1.kv.set(warKey, record);
            return { ok: true, sector, winCondition };
        }, { failClosed: true });
        if (!result.ok) {
            return res.status(409).json({ error: `No more than 7 of 8 sectors may share a win-condition.` });
        }
        return res.status(200).json(result);
    }
    catch (err) {
        console.error('[village/war-win-condition]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
