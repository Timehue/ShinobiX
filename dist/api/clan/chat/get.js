"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _storage_js_2 = require("./_storage.js");
/*
 * /api/clan/chat/get — GET only. Returns clan chat messages newer than `since`
 * (a client-held cursor) so idle polls transfer an empty list. Gated at clan
 * MEMBERSHIP: the caller (or admin) must belong to `clan`. Text-only, capped
 * buffer — cheap to poll while the Chat tab is open.
 *
 * Query: playerName, clan, since (ms, optional).
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const playerName = (0, _utils_js_1.safeName)(String(req.query.playerName ?? ''));
        const clan = String(req.query.clan ?? '').trim();
        const since = Math.max(0, Math.floor(Number(req.query.since ?? 0)) || 0);
        if (!playerName || !clan)
            return res.status(400).json({ error: 'Missing playerName or clan.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const slug = (0, _utils_js_1.clanBareSlug)(clan);
        if (!slug)
            return res.status(400).json({ error: 'Invalid clan name.' });
        // Membership: caller's character must belong to this clan (admin exempt).
        if (!identity.admin) {
            const save = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (save?.character ?? null);
            if (!char || (0, _utils_js_1.clanBareSlug)(String(char.clan ?? '')) !== slug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
        }
        const buf = (await _storage_js_1.kv.get((0, _storage_js_2.clanChatKey)(slug))) ?? [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ messages: (0, _storage_js_2.messagesSince)(buf, since) });
    }
    catch (err) {
        console.error('[clan/chat/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
