"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _single_use_token_js_1 = require("../_single-use-token.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'training-complete', 8, 30_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const tokenRaw = typeof body.token === 'string' ? body.token.trim() : '';
        const token = /^[A-Za-z0-9]+$/.test(tokenRaw) ? tokenRaw : '';
        const cancel = body.cancel === true;
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!token)
            return res.status(400).json({ error: 'Missing training token.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only complete your own training.' });
        }
        const tokenKey = `training-token:${playerName}:${token}`;
        // Peek first so a premature "collect" doesn't burn the token — only a real
        // grant consumes it.
        const peek = await _storage_js_1.kv.get(tokenKey);
        if (!peek) {
            return res.status(200).json({ ok: true, granted: false, reason: 'invalid-or-spent-token' });
        }
        if ((peek.playerName ?? '').toLowerCase() !== playerName.toLowerCase()) {
            return res.status(403).json({ error: 'Training token does not belong to this player.' });
        }
        const now = Date.now();
        if (!cancel && now < peek.endsAt) {
            return res.status(200).json({ ok: true, granted: false, reason: 'not-yet-complete', remainingMs: peek.endsAt - now });
        }
        // Time-gate passed (or cancel) — atomically consume. The delete rowcount is
        // the real double-collect gate: a racing second call gets null here.
        const data = await (0, _single_use_token_js_1.consumeSingleUseToken)(_storage_js_1.kv, tokenKey);
        if (!data) {
            return res.status(200).json({ ok: true, granted: false, reason: 'invalid-or-spent-token' });
        }
        let gain = Math.max(0, Math.floor(data.sealedGain));
        let xp = Math.max(0, Math.floor(data.sealedXp));
        if (cancel) {
            const totalMs = data.endsAt - data.startedAt;
            const frac = totalMs > 0 ? Math.max(0, Math.min(1, (now - data.startedAt) / totalMs)) : 1;
            gain = Math.floor(gain * frac);
            xp = Math.floor(xp * frac);
        }
        return res.status(200).json({ ok: true, granted: true, stat: data.stat, gain, xp });
    }
    catch (err) {
        console.error('[training/complete]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
