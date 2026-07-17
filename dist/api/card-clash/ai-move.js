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
const _ai_engine_js_1 = require("./_ai-engine.js");
/*
 * /api/card-clash/ai-move — POST only. Drives a SERVER-AUTHORITATIVE single-player
 * Shinobi Card Clash match started by ai-start.
 *
 *   { matchId, action:'play', handIndex, locationIndex }  → play one card (revealed)
 *   { matchId, action:'end-turn' }                        → AI responds, turn advances
 *   { matchId, action:'retreat' }                         → forfeit (opponent win)
 *   { matchId, action:'state' }                           → re-read the projection
 *
 * The winner is computed by the engine (determineWinner), NEVER supplied by the
 * client, so a fabricated win cannot be paid. On the terminal turn the reward is
 * settled from the SERVER-computed result (same amounts/daily-bonus as the old
 * ai-settle, via _ai-reward.ts) under the session lock, with a settledAt
 * idempotency guard so a replayed final move never double-pays. The pre-existing
 * min-win-duration guard (createdAt→now) is kept as anti-farming defence in depth.
 */
const MATCH_ID_RE = /^[0-9a-fA-F-]{20,80}$/;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
// Pay the Ryo reward from the SERVER-computed winner. Returns the credited
// character + reward, or an error status. Idempotent at the caller (settledAt).
async function settle(session, now) {
    const winner = session.winner ?? 'draw';
    const quickWin = winner === 'player' && now - Number(session.createdAt ?? 0) < _ai_reward_js_1.CARD_CLASH_AI_MIN_WIN_DURATION_MS;
    const today = (0, _ai_reward_js_1.utcDateKey)(now);
    const settled = await (0, _mutate_player_save_js_1.mutatePlayerSave)(session.playerName, ({ character }) => {
        const alreadyWonToday = String(character.cardClashDailyWinDate ?? '') === today;
        const reward = quickWin ? { ryo: 0, dailyBonus: false } : (0, _ai_reward_js_1.cardClashAiReward)(winner, alreadyWonToday);
        const nextCharacter = {
            ...character,
            ryo: num(character.ryo) + reward.ryo,
            cardClashWins: num(character.cardClashWins) + (winner === 'player' ? 1 : 0),
            cardClashLosses: num(character.cardClashLosses) + (winner === 'opponent' ? 1 : 0),
            cardClashDraws: num(character.cardClashDraws) + (winner === 'draw' ? 1 : 0),
            cardClashDailyWinDate: reward.dailyBonus ? today : character.cardClashDailyWinDate,
        };
        return {
            ok: true,
            character: nextCharacter,
            value: { result: winner, ryo: reward.ryo, dailyBonus: reward.dailyBonus },
        };
    });
    if (!settled.ok)
        return { ok: false, status: settled.status, error: settled.error };
    return { ok: true, reward: settled.value, character: settled.character, saveVersion: settled._saveVersion };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const matchId = String(body.matchId ?? '').trim();
        const action = String(body.action ?? '');
        if (!MATCH_ID_RE.test(matchId))
            return res.status(400).json({ error: 'Invalid matchId.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'card-clash-ai-move', 120, 60_000, identity.name)))
            return;
        const key = (0, _ai_reward_js_1.cardClashAiTokenKey)(matchId);
        const out = await (0, _lock_js_1.withKvLock)(key, async () => {
            const session = await _storage_js_1.kv.get(key);
            if (!session)
                return { status: 404, body: { error: 'Card match not found or expired.' } };
            if (!identity.admin && identity.name !== session.playerName) {
                return { status: 403, body: { error: 'Card match belongs to another player.' } };
            }
            // state: just project (returns the paid reward too if already settled).
            if (action === 'state') {
                return { status: 200, body: { ok: true, session: (0, _ai_engine_js_1.projectAiMatch)(session), reward: session.settledReward } };
            }
            if (action === 'play') {
                const handIndex = Math.floor(Number(body.handIndex));
                const locationIndex = Math.floor(Number(body.locationIndex));
                const res2 = (0, _ai_engine_js_1.playOne)(session, 'p1', handIndex, locationIndex);
                if (!res2.ok)
                    return { status: 400, body: { error: res2.error } };
                await _storage_js_1.kv.set(key, session, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                return { status: 200, body: { ok: true, session: (0, _ai_engine_js_1.projectAiMatch)(session) } };
            }
            if (action === 'end-turn' || action === 'retreat') {
                // Idempotent: a replayed terminal move returns the paid reward,
                // never a second payout.
                if ((0, _ai_engine_js_1.isDone)(session)) {
                    return { status: 200, body: { ok: true, session: (0, _ai_engine_js_1.projectAiMatch)(session), reward: session.settledReward } };
                }
                if (action === 'retreat')
                    (0, _ai_engine_js_1.forfeit)(session);
                else
                    (0, _ai_engine_js_1.endTurn)(session);
                if (!(0, _ai_engine_js_1.isDone)(session)) {
                    await _storage_js_1.kv.set(key, session, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                    return { status: 200, body: { ok: true, session: (0, _ai_engine_js_1.projectAiMatch)(session) } };
                }
                // Terminal turn → settle from the server-computed winner.
                const now = Date.now();
                const paid = await settle(session, now);
                if (!paid.ok) {
                    // Persist the finished match (unsettled) so a retry can pay; the
                    // status guard above keeps it single-pay once settledAt is set.
                    await _storage_js_1.kv.set(key, session, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                    return { status: paid.status, body: { error: paid.error } };
                }
                session.settledAt = now;
                session.settledReward = paid.reward;
                await _storage_js_1.kv.set(key, session, { ex: _ai_reward_js_1.CARD_CLASH_AI_TOKEN_TTL_SECONDS });
                return {
                    status: 200,
                    body: {
                        ok: true,
                        session: (0, _ai_engine_js_1.projectAiMatch)(session),
                        reward: paid.reward,
                        character: paid.character,
                        _saveVersion: paid.saveVersion,
                    },
                };
            }
            return { status: 400, body: { error: `Unknown action: ${action}` } };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        console.error('[card-clash/ai-move]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
