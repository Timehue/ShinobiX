"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _text_moderation_js_1 = require("../_text-moderation.js");
const _traces_js_1 = require("./_traces.js");
/*
 * /api/sector/trail-sign — POST only
 *
 * Leave a short trail sign at a tile in a wild sector, or "spark" (appreciate)
 * someone else's. Signs are name-attributed, moderated (reject + sanitize, the
 * village-chat pattern), and hard-capped so a sector can never accrete junk:
 * one active sign per player per sector (posting again replaces yours), oldest
 * evicted past the per-sector cap, 72h TTL, and a small per-day posting cap.
 * Pure social surface — no rewards flow through this endpoint in either
 * direction, so there is nothing to farm.
 *
 * Body: { playerName, sector, tile, text }                 → leave a sign
 *       { playerName, sector, action:'spark', signId }     → spark a sign
 * → { ok:true, signs:[…] } | { ok:false, reason } | { error }
 */
const SIGNS_KEY_TTL_SEC = 7 * 24 * 60 * 60;
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
        const sector = Math.floor(Number(body.sector ?? NaN));
        if (!(0, _traces_js_1.isTraceSector)(sector))
            return res.status(400).json({ error: 'Invalid sector.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'trail-sign', 8, 60_000, identity.name, { strict: true })))
            return;
        const now = Date.now();
        const key = (0, _traces_js_1.trailSignsKey)(sector);
        const action = body.action === 'spark' ? 'spark' : 'leave';
        if (action === 'spark') {
            const signId = typeof body.signId === 'string' ? body.signId : '';
            if (!signId)
                return res.status(400).json({ error: 'Missing signId.' });
            const out = await (0, _lock_js_1.withKvLock)(key, async () => {
                const result = (0, _traces_js_1.applySpark)((0, _traces_js_1.parseSigns)(await _storage_js_1.kv.get(key)), signId, playerName, now);
                if (!result.ok)
                    return result;
                await _storage_js_1.kv.set(key, result.signs, { ex: SIGNS_KEY_TTL_SEC });
                return result;
            });
            if (!out.ok)
                return res.status(200).json({ ok: false, reason: out.reason });
            return res.status(200).json({ ok: true, sparks: out.sparks });
        }
        // Leave a sign — moderate exactly like village chat: reject blocked content
        // outright, then sanitize (PII/profanity mask + length cap) what's stored.
        const rawText = typeof body.text === 'string' ? body.text.trim() : '';
        if (!rawText)
            return res.status(400).json({ error: 'Write something on the sign first.' });
        if (!identity.admin && !(0, _text_moderation_js_1.isCleanText)(rawText))
            return res.status(400).json({ error: 'Sign contains blocked content.' });
        const text = identity.admin ? rawText.slice(0, _text_moderation_js_1.TEXT_LIMITS.trailSign) : (0, _text_moderation_js_1.sanitizeUserText)(rawText, _text_moderation_js_1.TEXT_LIMITS.trailSign);
        if (!text)
            return res.status(400).json({ error: 'Empty sign after moderation.' });
        const tileRaw = Math.floor(Number(body.tile));
        const tile = Number.isFinite(tileRaw) && tileRaw >= 0 && tileRaw <= 143 ? tileRaw : 77;
        if (!identity.admin) {
            const posted = await _storage_js_1.kv.incr(`trail-sign-day:${playerName}:${(0, _traces_js_1.utcDayKey)(now)}`, { ex: 25 * 60 * 60 });
            if (posted > _traces_js_1.TRAIL_SIGNS_PER_DAY) {
                return res.status(200).json({ ok: false, reason: 'daily-cap', signsPerDay: _traces_js_1.TRAIL_SIGNS_PER_DAY });
            }
        }
        const sign = {
            id: `ts-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: playerName,
            tile,
            text,
            at: now,
            sparks: 0,
            sparkedBy: [],
        };
        const signs = await (0, _lock_js_1.withKvLock)(key, async () => {
            const next = (0, _traces_js_1.addSign)((0, _traces_js_1.parseSigns)(await _storage_js_1.kv.get(key)), sign, now);
            await _storage_js_1.kv.set(key, next, { ex: SIGNS_KEY_TTL_SEC });
            return next;
        });
        return res.status(200).json({
            ok: true,
            sign: { id: sign.id, name: sign.name, tile: sign.tile, text: sign.text, at: sign.at, sparks: 0 },
            signs: signs.map((s) => ({ id: s.id, name: s.name, tile: s.tile, text: s.text, at: s.at, sparks: s.sparks })),
        });
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'The trail post is busy — please retry.' });
        }
        console.error('[sector/trail-sign]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
