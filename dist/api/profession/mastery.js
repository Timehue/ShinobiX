"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _profession_mastery_js_1 = require("../_profession-mastery.js");
const RESPEC_COST = 50_000;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only update your own mastery.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'profession-mastery', 30, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            if (!character.profession)
                return { ok: false, status: 409, error: 'Choose a profession first.' };
            if (action === 'invest') {
                const masterySpec = (0, _profession_mastery_js_1.applyMasteryInvestment)(character.profession, character.professionXp, character.masterySpec, String(body.nodeId ?? ''));
                if (!masterySpec)
                    return { ok: false, status: 409, error: 'That mastery node cannot be increased.' };
                return { ok: true, character: { ...character, masterySpec }, value: { action } };
            }
            if (action === 'respec') {
                const ryo = Math.max(0, Number(character.ryo) || 0);
                if (ryo < RESPEC_COST)
                    return { ok: false, status: 409, error: `Respec costs ${RESPEC_COST} ryo.` };
                return { ok: true, character: { ...character, ryo: ryo - RESPEC_COST, masterySpec: {} }, value: { action } };
            }
            return { ok: false, status: 400, error: 'Invalid mastery action.' };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[profession/mastery]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
