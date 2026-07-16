"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _reward_js_1 = require("./_reward.js");
const WAR_ID_RE = /^[a-z0-9]+-vs-[a-z0-9]+$/;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const kind = body.kind === 'clan' ? 'clan' : body.kind === 'village' ? 'village' : '';
        const warId = String(body.warId ?? '').trim().toLowerCase();
        if (!playerName || !kind || !WAR_ID_RE.test(warId))
            return res.status(400).json({ error: 'Invalid war reward claim.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only claim your own war rewards.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'claim-war-reward', 30, 60_000, identity.name)))
            return;
        const war = kind === 'village'
            ? await _storage_js_1.kv.get(`world:war:${warId}`)
            : await _storage_js_1.kv.get(`clan-war:${warId}`);
        if (!war)
            return res.status(404).json({ error: 'War record not found.' });
        const outcome = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const reward = kind === 'village'
                ? (0, _reward_js_1.settleVillageWarRewards)(character, war)
                : (0, _reward_js_1.settleClanWarRewards)(character, war);
            return { ok: true, character: reward.character, value: reward };
        });
        if (!outcome.ok)
            return res.status(outcome.status).json({ error: outcome.error });
        return res.status(200).json({
            ok: true,
            ...outcome.value,
            character: outcome.character,
            _saveVersion: outcome._saveVersion,
        });
    }
    catch (error) {
        console.error('[war/claim-reward]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
