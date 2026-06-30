"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _ai_fight_reward_js_1 = require("./_ai-fight-reward.js");
// P0.2b — server-authoritative AI-fight reward with a daily soft-cap.
//
// The client reports the base XP/ryo it computed for an AI win; the server clamps
// it, applies the soft-cap from an AUTHORITATIVE date-keyed counter (so a tampered
// client can't bypass the cap by lying about its daily count), and credits XP (via
// the shared gainXp leveling — respecting exam gates + stat budget) and ryo under
// the save lock. This governs ONLY the XP+ryo faucet that breaks the 90-day curve;
// currency drops / kill counters / territory stay on the client save path (those
// are P0.2c's mint-token surface).
//
// Gated by AI_FIGHT_SERVER_AUTH (env). Default OFF → the endpoint is an inert
// no-op that credits nothing, so registering it can't add a credit path on top of
// the still-active client grant. It activates together with the client rewire
// (aiFightServerAuth.v1), which stops the local grant and applies this result.
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
        // Inert until the feature is enabled — never credits on the default path,
        // so it can't double-grant on top of the (still-active) client reward.
        if (process.env.AI_FIGHT_SERVER_AUTH !== '1') {
            return res.status(200).json({ ok: true, disabled: true, grantedXp: 0, grantedRyo: 0 });
        }
        const claimedXp = Number(body.xp ?? 0);
        const claimedRyo = Number(body.ryo ?? 0);
        const key = `save:${playerName}`;
        const result = await (0, _lock_js_1.withKvLock)(key, async () => {
            const record = await _storage_js_1.kv.get(key);
            if (!record)
                return { status: 404, body: { error: 'Player not found.' } };
            const char = record.character;
            if (!char)
                return { status: 404, body: { error: 'Character not found.' } };
            // Authoritative daily count (atomic incr; TTL so date keys self-evict).
            const dailyCount = await _storage_js_1.kv.incr(`ai-fight-count:${playerName}:${utcDateKey()}`, { ex: _ai_fight_reward_js_1.AI_FIGHT_DAILY_COUNT_TTL_SECONDS });
            const reward = (0, _ai_fight_reward_js_1.aiFightReward)(claimedXp, claimedRyo, dailyCount);
            const leveled = (0, _xp_engine_js_1.gainXp)({ ...char }, reward.xp);
            leveled.ryo = Math.max(0, Number(char.ryo ?? 0)) + reward.ryo;
            const updated = { ...record, character: leveled };
            (0, _save_version_js_1.bumpSaveVersion)(updated);
            await _storage_js_1.kv.set(key, (0, _utils_js_1.mergePreservingImages)(updated, record));
            return {
                status: 200,
                body: {
                    ok: true,
                    grantedXp: reward.xp,
                    grantedRyo: reward.ryo,
                    capped: reward.capped,
                    dailyCount,
                    level: leveled.level,
                    xp: leveled.xp,
                    ryo: leveled.ryo,
                },
            };
        }, { failClosed: true });
        return res.status(result.status).json(result.body);
    }
    catch (err) {
        console.error('[missions/report-ai-fight]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
