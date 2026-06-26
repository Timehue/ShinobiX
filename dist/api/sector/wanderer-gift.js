"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _wanderer_gift_js_1 = require("./_wanderer-gift.js");
/*
 * /api/sector/wanderer-gift — POST only
 *
 * A friendly sector Wanderer hands the player a small gift. Server-authoritative:
 * the reward is RECOMPUTED here (never read from the client) and bounded by a
 * per-day cap, so it can't be farmed into a ryo faucet. Mirrors the
 * recompute-server-side pattern in docs/auth-and-anti-cheat-patterns.md.
 *
 * Body: { playerName, sector? }
 * → { ok:true, ryo, totalRyo, claimsLeft } | { ok:false, reason }
 */
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
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'wanderer-gift', 12, 60_000, identity.name)))
            return;
        const dayKey = `wanderer-gift:${playerName}:${utcDateKey()}`;
        const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
            const rec = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (rec?.character ?? null);
            if (!rec || !char)
                return { status: 404, body: { error: 'Your save was not found.' } };
            // Burn a daily slot only now that the save is verified, inside the lock
            // and immediately before payout — failures never consume a slot. incr
            // returns the post-increment count, so claimsSoFar (count BEFORE this
            // gift) = countAfter - 1.
            const countAfter = await _storage_js_1.kv.incr(dayKey, { ex: 25 * 60 * 60 });
            const claimsSoFar = Math.max(0, countAfter - 1);
            const decision = (0, _wanderer_gift_js_1.decideWandererGift)(claimsSoFar);
            if (!decision.ok) {
                return { status: 200, body: { ok: false, reason: decision.reason, claimsLeft: 0 } };
            }
            // Roll the bundle SERVER-SIDE (never trust the client) and grant it.
            const gift = (0, _wanderer_gift_js_1.rollWandererGift)(Number(char.level ?? 1), Math.random);
            const updated = {
                ...char,
                ryo: Number(char.ryo ?? 0) + gift.ryo,
                fateShards: Number(char.fateShards ?? 0) + gift.fateShards,
                boneCharms: Number(char.boneCharms ?? 0) + gift.boneCharms,
            };
            const record = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: updated });
            await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(record, rec));
            return {
                status: 200,
                body: {
                    ok: true,
                    gift,
                    totals: { ryo: updated.ryo, fateShards: updated.fateShards, boneCharms: updated.boneCharms },
                    claimsLeft: Math.max(0, _wanderer_gift_js_1.WANDERER_GIFTS_PER_DAY - countAfter),
                },
            };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'Could not grant the gift — please retry.' });
        }
        console.error('[sector/wanderer-gift]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
