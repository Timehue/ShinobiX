"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _ai_fight_reward_js_1 = require("./_ai-fight-reward.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _single_use_token_js_1 = require("../_single-use-token.js");
const _ai_fight_token_js_1 = require("./_ai-fight-token.js");
// P0.2b — server-authoritative daily SOFT-CAP for AI-fight XP/ryo.
//
// The client reports the base XP/ryo it computed for an AI win with a single-use
// token minted by /api/missions/ai-fight-start. The server validates the claim
// against that sealed token, applies the authoritative daily soft-cap, and returns
// the allowed amounts. The client then grants exactly that, inside its single save
// write.
//
// Why return-only (not credit-on-the-server): the AI-win grant is entangled — the
// client must still write territory/kills/crates/missions to the save — so if this
// endpoint ALSO wrote the save we'd have two writers racing on save:<name>. By
// returning the allowed amount and letting the client apply it, there is exactly
// one writer and no race. AI-fight rewards affect PROGRESSION SPEED, not the PvP
// power ceiling, so capping honest play here (the 90-day-curve concern) is the goal;
// the existing per-save / per-minute save-sanitizer caps remain the floor against a
// tampered client.
//
// The client only calls this (and honors the result) when aiFightServerAuth.v1 is
// on; stale clients never call it. The endpoint credits nothing, so it is safe to
// expose unconditionally — the only state it touches is the caller's own daily
// counter (auth-gated to the player's own name).
function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own fights.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'report-ai-fight', 30, 60_000, identity.name)))
            return;
        const aiFightToken = (0, _ai_fight_token_js_1.cleanAiFightToken)(body.aiFightToken ?? body.token);
        if (!aiFightToken) {
            return res.status(200).json({ ok: true, xp: 0, ryo: 0, capped: false, dailyCount: null, reason: 'missing-ai-fight-token' });
        }
        const tokenData = await (0, _single_use_token_js_1.consumeSingleUseToken)(_storage_js_1.kv, (0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, aiFightToken));
        if (!tokenData) {
            return res.status(200).json({ ok: true, xp: 0, ryo: 0, capped: false, dailyCount: null, reason: 'invalid-or-spent-ai-fight-token' });
        }
        if ((tokenData.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
            return res.status(403).json({ error: 'AI fight token does not belong to this player.' });
        }
        const claim = (0, _ai_fight_token_js_1.validateAiFightRewardClaim)(tokenData, body.xp, body.ryo);
        if (!claim.ok) {
            return res.status(200).json({ ok: true, xp: 0, ryo: 0, capped: false, dailyCount: null, reason: claim.reason });
        }
        // Authoritative running daily count (atomic; TTL so date keys self-evict).
        const dailyCount = await _storage_js_1.kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: _ai_fight_reward_js_1.AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
        const reward = (0, _ai_fight_reward_js_1.aiFightReward)(claim.xp, claim.ryo, dailyCount);
        // Legacy tracking (ENABLE_LEGACY): PvE kill credit follows the same
        // daily soft cap as the reward — grinding past it stops feeding Legacy
        // eligibility too. Style kills bucket by the save's declared specialty.
        if ((0, _legacy_track_js_1.legacyEnabled)() && dailyCount <= _ai_fight_reward_js_1.AI_FIGHT_SOFT_CAP_PER_DAY) {
            try {
                const record = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = record?.character;
                const deltas = { pveKills: 1 };
                const specialty = String(char?.specialty ?? '');
                if (specialty === 'Ninjutsu')
                    deltas.ninjutsuKills = 1;
                else if (specialty === 'Genjutsu')
                    deltas.genjutsuKills = 1;
                else if (specialty === 'Taijutsu')
                    deltas.taijutsuKills = 1;
                else if (specialty === 'Bukijutsu')
                    deltas.bukijutsuKills = 1;
                await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, deltas, { characterForBootstrap: char ?? null });
            }
            catch (legacyErr) {
                // Tracking must never 500 a reward response whose daily counter
                // already advanced (verification finding).
                console.error('[report-ai-fight] legacy tracking failed:', legacyErr);
            }
        }
        return res.status(200).json({ ok: true, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount });
    }
    catch (err) {
        console.error('[missions/report-ai-fight]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
