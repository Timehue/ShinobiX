"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _ai_reward_js_1 = require("./_ai-reward.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'You can only start your own AI card match.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'card-clash-ai-start', 30, 60_000, identity.name)))
            return;
        const matchId = (0, node_crypto_1.randomUUID)();
        const token = { matchId, playerName, createdAt: Date.now() };
        await _storage_js_1.kv.set((0, _ai_reward_js_1.cardClashAiTokenKey)(matchId), token, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
        return res.status(200).json({ ok: true, matchId, createdAt: token.createdAt });
    }
    catch (err) {
        console.error('[card-clash/ai-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
