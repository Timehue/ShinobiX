"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _cafeteria_js_1 = require("./_cafeteria.js");
/*
 * /api/player/cafeteria - POST
 *
 * Server-side cafeteria meals. The client no longer edits ryo/vitals directly;
 * the server checks balance, blocks active battles, applies the meal under the
 * save lock, and returns the updated character snapshot.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const meal = (0, _cafeteria_js_1.cafeteriaMeal)(body.mealId);
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        if (!meal)
            return res.status(400).json({ error: 'Unknown cafeteria meal.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'You can only buy meals for your own account.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'player-cafeteria', 30, 60_000, identity.name)))
            return;
        if (!identity.admin && online_store_js_1.onlineStore.get(playerName)?.inBattle) {
            return res.status(409).json({ error: 'Cannot eat while in an active battle.' });
        }
        if (!identity.admin && await _storage_js_1.kv.get(`battle-lock:${playerName}`)) {
            return res.status(409).json({ error: 'Resolve your active battle before eating.' });
        }
        const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const applied = (0, _cafeteria_js_1.applyCafeteriaMeal)(character, meal);
            if (!applied.ok)
                return { ok: false, status: 400, error: applied.error };
            return { ok: true, character: applied.character, value: { meal } };
        });
        if (!out.ok)
            return res.status(out.status).json({ error: out.error });
        return res.status(200).json({ ok: true, meal, character: out.character, _saveVersion: out._saveVersion });
    }
    catch (err) {
        console.error('[player/cafeteria]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
