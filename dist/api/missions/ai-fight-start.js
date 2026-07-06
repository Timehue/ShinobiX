"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _ai_fight_token_js_1 = require("./_ai-fight-token.js");
/*
 * /api/missions/ai-fight-start - POST only
 *
 * Mints a single-use token for one AI-fight reward report. The report endpoint
 * consumes this token and only accepts XP/ryo claims within the sealed ceilings,
 * so a direct client report can no longer mint arbitrary rewards.
 */
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
            return res.status(403).json({ error: 'Can only start your own AI fights.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'ai-fight-start', 30, 60_000, identity.name)))
            return;
        const save = await _storage_js_1.kv.get(`save:${playerName}`);
        const character = (save?.character ?? null);
        if (!save || !character)
            return res.status(404).json({ error: 'Player save not found.' });
        const reward = (0, _ai_fight_token_js_1.computeAiFightBaseReward)(character);
        const token = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
        const record = (0, _ai_fight_token_js_1.createAiFightTokenRecord)(playerName, token, Date.now(), {
            opponentId: body.opponentId,
            opponentLevel: body.opponentLevel,
            baseXp: reward.xp,
            baseRyo: reward.ryo,
        });
        await _storage_js_1.kv.set((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, token), record, { ex: _ai_fight_token_js_1.AI_FIGHT_TOKEN_TTL_SECONDS });
        return res.status(200).json({
            ok: true,
            token,
            expiresInSeconds: _ai_fight_token_js_1.AI_FIGHT_TOKEN_TTL_SECONDS,
            maxXp: record.maxXp,
            maxRyo: record.maxRyo,
            baseXp: record.baseXp,
            baseRyo: record.baseRyo,
            trait: reward.trait,
        });
    }
    catch (err) {
        console.error('[missions/ai-fight-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
