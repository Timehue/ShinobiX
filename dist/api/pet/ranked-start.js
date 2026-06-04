"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const crypto_1 = require("crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _ranked_rating_js_1 = require("../_ranked-rating.js");
/*
 * /api/pet/ranked-start — POST only
 *
 * Mints a single-use pet-ranked MATCH TOKEN (audit #9). The token seals BOTH
 * fighters' pre-match petRankedRating (read from their saves, authoritative) at
 * the moment the ranked pet battle begins. pet/battle-result REQUIRES this
 * token for a ranked credit and settles BOTH accounts from the sealed ratings
 * exactly once — so the pet ranked ladder can no longer be moved by a client
 * that just asserts `ranked: true` with an arbitrary opponent / rating.
 *
 * Pet ranked is not yet wired on the client (the ranked pet path in
 * pet/battle-result is dormant); this is the server half, ready for the client
 * to call when the feature ships: POST { opponentName } → { matchToken }.
 *
 * Body: { opponentName }
 */
const TOKEN_TTL_SECONDS = 15 * 60; // a full pet battle + report fits comfortably
function petRatingOf(save) {
    const c = (save?.character ?? null);
    const r = Number(c?.petRankedRating);
    return Number.isFinite(r) ? r : _ranked_rating_js_1.DEFAULT_RANKED_RATING;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) {
        // Admin has no single player identity to seal a ranked match for.
        return res.status(400).json({ error: 'Ranked pet matches require a player identity.' });
    }
    const rlName = identity.name;
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-ranked-start', 12, 60_000, rlName)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const me = identity.name;
        const opponent = (0, _utils_js_1.safeName)(typeof body.opponentName === 'string' ? body.opponentName : '');
        if (!opponent)
            return res.status(400).json({ error: 'Missing opponentName.' });
        if (opponent === me)
            return res.status(400).json({ error: 'You cannot start a ranked match against yourself.' });
        // Both fighters must have a save (no AI/roster ranked credit).
        const [meSave, oppSave] = await Promise.all([
            _storage_js_1.kv.get(`save:${me}`),
            _storage_js_1.kv.get(`save:${opponent}`),
        ]);
        if (!meSave?.character)
            return res.status(400).json({ error: 'Your character save was not found.' });
        if (!oppSave?.character)
            return res.status(404).json({ error: 'Opponent save not found.' });
        const token = (0, crypto_1.randomUUID)();
        await _storage_js_1.kv.set(`pet:ranked-token:${token}`, {
            a: me,
            b: opponent,
            aRating: petRatingOf(meSave),
            bRating: petRatingOf(oppSave),
            createdAt: Date.now(),
        }, { ex: TOKEN_TTL_SECONDS });
        return res.status(200).json({ ok: true, matchToken: token, opponentName: opponent });
    }
    catch (err) {
        console.error('[pet/ranked-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
