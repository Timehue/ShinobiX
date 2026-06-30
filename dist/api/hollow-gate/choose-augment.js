"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _run_token_js_1 = require("./_run-token.js");
/*
 * /api/hollow-gate/choose-augment  — POST only
 *
 * Re-seals an open run token with the player's chosen augment (which must be one
 * of the three the SERVER offered at start — the client can't smuggle in an
 * augment it wasn't offered). The reward multiplier stays sealed server-side;
 * settle reads it from chosenAugmentId, never from the client.
 * Body: { playerName, token, augmentId }.
 */
// Re-seal preserves the token's lifetime: match start.ts's resumable-run TTL so
// choosing an augment never shortens the window (see start.ts for the rationale).
const RUN_TTL_SEC = 24 * 60 * 60;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const augmentId = String(body.augmentId ?? '').slice(0, 48);
        if (!playerName || !token || !augmentId)
            return res.status(400).json({ error: 'Missing playerName, token, or augmentId.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hollow-gate-choose', 30, 60_000, identity.name)))
            return;
        const key = `hg-run:${playerName}:${token}`;
        const run = await _storage_js_1.kv.get(key);
        if (!run)
            return res.status(200).json({ ok: true, reason: 'invalid-or-spent' });
        if (run.playerName.toLowerCase() !== playerName.toLowerCase())
            return res.status(403).json({ error: 'Not your run.' });
        if (run.chosenAugmentId)
            return res.status(200).json({ ok: true, reason: 'already-chosen', chosenAugmentId: run.chosenAugmentId });
        if (!run.offeredAugmentIds.includes(augmentId) || !_run_token_js_1.AUGMENT_CATALOG[augmentId]) {
            return res.status(400).json({ error: 'That augment was not offered for this run.' });
        }
        await _storage_js_1.kv.set(key, { ...run, chosenAugmentId: augmentId }, { ex: RUN_TTL_SEC });
        return res.status(200).json({ ok: true, chosenAugmentId: augmentId });
    }
    catch (err) {
        console.error('[hollow-gate/choose-augment]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
