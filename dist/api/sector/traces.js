"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const shrines_js_1 = require("../../shared/shrines.js");
const _traces_js_1 = require("./_traces.js");
/*
 * /api/sector/traces — GET only
 *
 * Read-only snapshot of a wild sector's social traces: today's footfall count,
 * the active trail signs, and (in shrine sectors) the shrine ledger. World-public
 * data — everything in it (player names, offerings) is already visible in-game —
 * so no auth, just a light rate limit. Writes happen in /sector/trail-sign and
 * /sector/shrine-offer.
 *
 * Query: ?sector=<1-60>[&player=<name>]  (player → which signs YOU have sparked)
 * → { ok, sector, footfallToday, signs:[{id,name,tile,text,at,sparks}],
 *     mySparked:[signId], shrine?: {id,name,region,blessing,tier,tierName,total,
 *     weekTotal,topWeek,lastWeek} }
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'sector-traces', 90, 60_000))
        return;
    try {
        const sector = Math.floor(Number(req.query?.sector ?? NaN));
        if (!(0, _traces_js_1.isTraceSector)(sector))
            return res.status(400).json({ error: 'Invalid sector.' });
        const player = (0, _utils_js_1.safeName)(String(req.query?.player ?? ''));
        const now = Date.now();
        const [footfallRaw, signsRaw] = await Promise.all([
            _storage_js_1.kv.get((0, _traces_js_1.footfallKey)(sector, now)),
            _storage_js_1.kv.get((0, _traces_js_1.trailSignsKey)(sector)),
        ]);
        const signs = (0, _traces_js_1.pruneSigns)((0, _traces_js_1.parseSigns)(signsRaw), now);
        const def = (0, shrines_js_1.shrineForSector)(sector);
        let shrine;
        if (def) {
            const state = (0, _traces_js_1.parseShrineState)(await _storage_js_1.kv.get((0, _traces_js_1.shrineKey)(def.id)));
            const tier = (0, shrines_js_1.shrineTier)(state.total);
            shrine = {
                id: def.id,
                name: def.name,
                theme: def.theme,
                ...(def.village ? { village: def.village } : {}),
                region: def.region,
                lore: def.lore,
                blessing: def.blessing,
                tier,
                total: state.total,
                weekTotal: state.week === undefined ? 0 : state.weekTotal,
                topWeek: state.topWeek.slice(0, _traces_js_1.TOP_OFFERERS_SHOWN),
                lastWeek: state.lastWeek
                    ? { week: state.lastWeek.week, topWeek: state.lastWeek.topWeek.slice(0, _traces_js_1.TOP_OFFERERS_SHOWN) }
                    : null,
            };
        }
        return res.status(200).json({
            ok: true,
            sector,
            footfallToday: Math.max(0, Math.floor(Number(footfallRaw)) || 0),
            signs: signs.map((s) => ({ id: s.id, name: s.name, tile: s.tile, text: s.text, at: s.at, sparks: s.sparks })),
            mySparked: player ? signs.filter((s) => s.sparkedBy.includes(player)).map((s) => s.id) : [],
            ...(shrine ? { shrine } : {}),
        });
    }
    catch (err) {
        console.error('[sector/traces]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
