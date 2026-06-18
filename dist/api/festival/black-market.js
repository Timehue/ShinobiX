"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _black_market_js_1 = require("./_black-market.js");
/*
 * /api/festival/black-market — POST (one ryo-gamble pull)
 *
 * Server-authoritative gamble in the Sunscar Festival. Fully resolved on the
 * server in one shot (no client-reported outcome): under the save lock we check
 * the daily cap + balance, debit the COST, roll the payout server-side, credit
 * it, and bump the per-day counter. The client only renders what we return.
 *
 *   POST { playerName } → { ok, cost, reward, dailyUsed, dailyCap, balanceRyo }
 *
 * It is a SINK by construction (expected ryo return < cost, see _black-market.ts).
 */
const COUNT_PREFIX = 'bm:count:';
const COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function dateKeyUTC(now) {
    return new Date(now).toISOString().slice(0, 10);
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
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'black-market', 30, 60_000, identity.name)))
            return;
        const now = Date.now();
        const countKey = `${COUNT_PREFIX}${playerName}:${dateKeyUTC(now)}`;
        const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
            const rec = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (rec?.character ?? null);
            if (!rec || !char)
                return { status: 404, body: { error: 'Your save was not found.' } };
            const used = num(await _storage_js_1.kv.get(countKey));
            if (used >= _black_market_js_1.BLACK_MARKET_DAILY_CAP) {
                return { status: 429, body: { error: `The black market is done with you today (${_black_market_js_1.BLACK_MARKET_DAILY_CAP}/${_black_market_js_1.BLACK_MARKET_DAILY_CAP}). Return after midnight UTC.`, dailyUsed: used, dailyCap: _black_market_js_1.BLACK_MARKET_DAILY_CAP } };
            }
            if (num(char.ryo) < _black_market_js_1.BLACK_MARKET_COST) {
                return { status: 400, body: { error: `Not enough ryo. A pull costs ${_black_market_js_1.BLACK_MARKET_COST.toLocaleString()}.` } };
            }
            const reward = (0, _black_market_js_1.rollBlackMarket)(Math.random);
            const nextChar = {
                ...char,
                ryo: num(char.ryo) - _black_market_js_1.BLACK_MARKET_COST + reward.ryo,
                fateShards: num(char.fateShards) + reward.fateShards,
                boneCharms: num(char.boneCharms) + reward.boneCharms,
                auraStones: num(char.auraStones) + reward.auraStones,
                mythicSeals: num(char.mythicSeals) + reward.mythicSeals,
            };
            await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)({ ...rec, character: nextChar }, rec));
            await _storage_js_1.kv.set(countKey, used + 1, { ex: COUNT_TTL_SECONDS });
            return { status: 200, body: { ok: true, cost: _black_market_js_1.BLACK_MARKET_COST, reward, dailyUsed: used + 1, dailyCap: _black_market_js_1.BLACK_MARKET_DAILY_CAP, balanceRyo: num(nextChar.ryo) } };
        }, { failClosed: true });
        if (out.status === 200) {
            await _storage_js_1.kv.set(`audit:black-market:${now}`, { ts: now, player: playerName, cost: _black_market_js_1.BLACK_MARKET_COST, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        console.error('[festival/black-market]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
