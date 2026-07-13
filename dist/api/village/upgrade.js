"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _upgrade_js_1 = require("./_upgrade.js");
const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your upgrade.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-upgrade', 20, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => { const state = await _storage_js_1.kv.get(`game:village-state:${slug(character.village)}`); if (!identity.admin && (0, _utils_js_1.safeName)(state?.seatedKage ?? '') !== playerName)
            return { ok: false, status: 403, error: 'Only the seated Kage can upgrade village structures.' }; const out = (0, _upgrade_js_1.purchaseVillageUpgrade)(character, body.key); if (!out.ok)
            return { ok: false, status: 409, error: out.reason }; return { ok: true, character: out.character, value: { cost: out.cost, level: out.level } }; });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[village/upgrade]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
