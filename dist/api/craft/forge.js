"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _forge_js_1 = require("./_forge.js");
const requestId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(v) ? v : '';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const id = requestId(body.requestId);
        const kind = String(body.kind ?? '');
        const recipeId = String(body.recipeId ?? '').slice(0, 96);
        if (!playerName || !id || !['supply', 'weapon', 'armor', 'relic'].includes(kind))
            return res.status(400).json({ error: 'Invalid craft request.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your forge.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'craft-forge', 40, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const receipts = Array.isArray(character.redeemedCrafts) ? character.redeemedCrafts : [];
            if (receipts.includes(id))
                return { ok: true, character, value: { replayed: true } };
            const next = (0, _forge_js_1.applyForge)(character, kind, recipeId, body.quantity);
            if (!next)
                return { ok: false, status: 409, error: 'invalid-or-unaffordable-recipe' };
            return { ok: true, character: { ...next, redeemedCrafts: [...receipts.slice(-99), id] }, value: { replayed: false } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[craft/forge]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
