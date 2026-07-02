"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _ai_fight_reward_js_1 = require("./_ai-fight-reward.js");
const _stat_growth_js_1 = require("../_stat-growth.js");
// P0.2b — server-authoritative daily SOFT-CAP for AI-fight XP/ryo.
//
// The client reports the base XP/ryo it computed for an AI win; the server applies
// the soft-cap using an AUTHORITATIVE per-day counter (atomic incr, so a client
// can't fake its running daily total) and RETURNS the allowed amounts. The client
// then grants exactly that, inside its single save write.
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
        // Authoritative running daily count (atomic; TTL so date keys self-evict).
        const dailyCount = await _storage_js_1.kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: _ai_fight_reward_js_1.AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
        const reward = (0, _ai_fight_reward_js_1.aiFightReward)(body.xp, body.ryo, dailyCount);
        // Combat-use stat growth (Stage 4): a small, hard-daily-capped stat reward
        // for the win — auto-grown into the stats the player has invested in, plus a
        // free-pool share. The client applies the returned allocation in its single
        // save write (sanitizer-bounded). A bonus — never a reason to fail the report.
        let statGrowth = { allocated: {}, unspentGain: 0 };
        try {
            const record = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = record?.character;
            if (char) {
                const stats = (char.stats ?? {});
                const level = Number(char.level) || 1;
                const budgetKey = `combat-stat-count:${playerName}:${utcDateKey()}`;
                statGrowth = await (0, _lock_js_1.withKvLock)(budgetKey, async () => {
                    const spentToday = Number((await _storage_js_1.kv.get(budgetKey)) ?? 0);
                    const remaining = Math.max(0, _stat_growth_js_1.DAILY_COMBAT_STAT_CAP - spentToday);
                    const g = (0, _stat_growth_js_1.computeCombatStatGrowth)(stats, level, _stat_growth_js_1.AI_FIGHT_STAT_POINTS_PER_WIN, remaining);
                    if (g.spent > 0)
                        await _storage_js_1.kv.set(budgetKey, spentToday + g.spent, { ex: 25 * 60 * 60 }).catch(() => undefined);
                    return { allocated: g.allocated, unspentGain: g.unspentGain };
                });
            }
        }
        catch (err) {
            console.warn('[missions/report-ai-fight] stat-growth skipped:', err);
        }
        return res.status(200).json({ ok: true, xp: reward.xp, ryo: reward.ryo, capped: reward.capped, dailyCount, statGrowth });
    }
    catch (err) {
        console.error('[missions/report-ai-fight]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
