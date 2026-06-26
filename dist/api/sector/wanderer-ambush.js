"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _wanderer_ambush_js_1 = require("./_wanderer-ambush.js");
/*
 * /api/sector/wanderer-ambush — POST { action: 'start' | 'claim', playerName }
 *
 * Boss reward for clearing a sector-wanderer ambush. Server-authoritative:
 *   start → seal baseline foe-kills in KV (1h TTL)
 *   claim → verify the player won AMBUSH_KILLS_REQUIRED more fights since (cleared
 *           the gauntlet), roll the reward server-side, grant under the save lock,
 *           consume the token. Daily-capped.
 * The reward is recomputed/rolled here, never trusted from the client.
 */
const TOKEN_TTL_SECONDS = 60 * 60;
const tokenKeyFor = (player) => `wanderer-ambush:${player}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const utcDateKey = () => new Date().toISOString().slice(0, 10);
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, `wanderer-ambush-${action}`, 20, 60_000, identity.name)))
            return;
        const tokenKey = tokenKeyFor(playerName);
        // ── START: seal the foe-kill baseline ─────────────────────────────────
        if (action === 'start') {
            const rec = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (rec?.character ?? null);
            if (!rec || !char)
                return res.status(404).json({ error: 'Your save was not found.' });
            await _storage_js_1.kv.set(tokenKey, { baseline: num(char.totalAiKills), at: Date.now() }, { ex: TOKEN_TTL_SECONDS });
            return res.status(200).json({ ok: true });
        }
        // ── CLAIM: verify the gauntlet was cleared, then pay ──────────────────
        if (action === 'claim') {
            const sealed = await _storage_js_1.kv.get(tokenKey);
            if (!sealed)
                return res.status(200).json({ ok: false, reason: 'none' });
            const today = utcDateKey();
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const fresh = await _storage_js_1.kv.get(tokenKey);
                if (!fresh)
                    return { status: 200, body: { ok: false, reason: 'none' } };
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { status: 404, body: { error: 'Your save was not found.' } };
                if (!(0, _wanderer_ambush_js_1.ambushCleared)(num(fresh.baseline), num(char.totalAiKills))) {
                    return { status: 200, body: { ok: false, reason: 'incomplete' } };
                }
                // Burn a daily slot only now that the claim is verified, inside the
                // lock and immediately before payout — failures never consume a slot.
                const claimedToday = await _storage_js_1.kv.incr(`wanderer-ambush-count:${playerName}:${today}`, { ex: 25 * 60 * 60 });
                if (claimedToday > _wanderer_ambush_js_1.AMBUSH_REWARDS_PER_DAY) {
                    return { status: 200, body: { ok: false, reason: 'daily-cap' } };
                }
                const reward = (0, _wanderer_ambush_js_1.rollAmbushReward)(num(char.level) || 1, Math.random);
                const updated = {
                    ...char,
                    ryo: num(char.ryo) + reward.ryo,
                    fateShards: num(char.fateShards) + reward.fateShards,
                    boneCharms: num(char.boneCharms) + reward.boneCharms,
                };
                const record = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated });
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(record, rec));
                await _storage_js_1.kv.del(tokenKey).catch(() => undefined);
                return {
                    status: 200,
                    body: {
                        ok: true,
                        reward,
                        totals: { ryo: updated.ryo, fateShards: updated.fateShards, boneCharms: updated.boneCharms },
                    },
                };
            }, { failClosed: true });
            return res.status(out.status).json(out.body);
        }
        return res.status(400).json({ error: 'Unknown action.' });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not grant the reward — please retry.' });
        }
        console.error('[sector/wanderer-ambush]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
