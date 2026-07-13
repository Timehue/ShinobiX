"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _ai_fight_token_js_1 = require("../missions/_ai-fight-token.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _settle_js_1 = require("./_settle.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const token = (0, _ai_fight_token_js_1.cleanAiFightToken)(body.aiFightToken ?? body.token);
        if (!playerName || !token)
            return res.status(400).json({ error: 'Player name and battle token are required.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only settle your own story battle.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'story-settle', 12, 60_000, identity.name)))
            return;
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
            const redeemed = Array.isArray(character.redeemedStoryBattles)
                ? character.redeemedStoryBattles.filter((entry) => !!entry && typeof entry === 'object' && typeof entry.token === 'string')
                : [];
            const prior = redeemed.find((entry) => entry.token === token);
            if (prior)
                return { ok: true, character, value: { ...prior, replayed: true } };
            const tokenData = await _storage_js_1.kv.get((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, token));
            if (!tokenData)
                return { ok: false, status: 409, error: 'Story battle token is invalid or already spent.' };
            if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase())
                return { ok: false, status: 403, error: 'Battle token belongs to another player.' };
            const settled = body.kind === 'academySparring'
                ? (0, _settle_js_1.applyAcademySparSettlement)(character, tokenData)
                : (0, _settle_js_1.applyStoryBossSettlement)(character, tokenData, body.survivingHp);
            if (!settled.ok)
                return settled;
            const redemption = { token, progress: settled.progress, xp: settled.xp, ryo: settled.ryo, auraDust: settled.auraDust, finale: settled.finale };
            return {
                ok: true,
                character: { ...settled.character, redeemedStoryBattles: [...redeemed.slice(-19), redemption] },
                value: { ...redemption, replayed: false, title: settled.title },
            };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        await _storage_js_1.kv.del((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, token)).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (err) {
        console.error('[story/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
