"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _war_crate_open_js_1 = require("./_war-crate-open.js");
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
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only open your own war crates.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'open-war-crate', 20, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const opened = (0, _war_crate_open_js_1.applyWarCrateOpen)(character, (0, node_crypto_1.randomInt)(100) < 35);
            if (!opened)
                return { ok: false, status: 409, error: 'No Legendary War Crate is available.' };
            return { ok: true, character: opened.character, value: opened.reward };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            reward: result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    }
    catch (err) {
        console.error('[village/open-war-crate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
