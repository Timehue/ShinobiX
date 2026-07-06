"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _lock_js_1 = require("../_lock.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _ai_reward_js_1 = require("./_ai-reward.js");
const MATCH_ID_RE = /^[0-9a-fA-F-]{20,80}$/;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const matchId = String(body.matchId ?? '').trim();
        const result = (0, _ai_reward_js_1.cleanCardClashAiResult)(body.result);
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        if (!MATCH_ID_RE.test(matchId))
            return res.status(400).json({ error: 'Invalid matchId.' });
        if (!result)
            return res.status(400).json({ error: 'Invalid match result.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'You can only settle your own AI card match.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'card-clash-ai-settle', 30, 60_000, identity.name)))
            return;
        const tokenKey = (0, _ai_reward_js_1.cardClashAiTokenKey)(matchId);
        const out = await (0, _lock_js_1.withKvLock)(tokenKey, async () => {
            const token = await _storage_js_1.kv.get(tokenKey);
            if (!token)
                return { status: 404, body: { error: 'Card match token not found or expired.' } };
            if (token.playerName !== playerName)
                return { status: 403, body: { error: 'Card match token belongs to another player.' } };
            if (token.settledAt)
                return { status: 409, body: { error: 'Card match already settled.' } };
            const now = Date.now();
            const quickWin = result === 'player' && now - Number(token.createdAt ?? 0) < _ai_reward_js_1.CARD_CLASH_AI_MIN_WIN_DURATION_MS;
            const today = (0, _ai_reward_js_1.utcDateKey)(now);
            const settled = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
                const alreadyWonToday = String(character.cardClashDailyWinDate ?? '') === today;
                const reward = quickWin ? { ryo: 0, dailyBonus: false } : (0, _ai_reward_js_1.cardClashAiReward)(result, alreadyWonToday);
                const nextCharacter = {
                    ...character,
                    ryo: num(character.ryo) + reward.ryo,
                    cardClashWins: num(character.cardClashWins) + (result === 'player' ? 1 : 0),
                    cardClashLosses: num(character.cardClashLosses) + (result === 'opponent' ? 1 : 0),
                    cardClashDraws: num(character.cardClashDraws) + (result === 'draw' ? 1 : 0),
                    cardClashDailyWinDate: reward.dailyBonus ? today : character.cardClashDailyWinDate,
                };
                return {
                    ok: true,
                    character: nextCharacter,
                    value: { result, ryo: reward.ryo, dailyBonus: reward.dailyBonus, quickWin },
                };
            });
            if (!settled.ok)
                return { status: settled.status, body: { error: settled.error } };
            await _storage_js_1.kv.set(tokenKey, { ...token, settledAt: now }, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
            return {
                status: 200,
                body: {
                    ok: true,
                    ...settled.value,
                    character: settled.character,
                    _saveVersion: settled._saveVersion,
                },
            };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        console.error('[card-clash/ai-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
