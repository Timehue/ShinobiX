"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _storage_js_2 = require("./_storage.js");
/*
 * /api/clan/chat/send — POST only. Appends one text message to the clan's capped
 * chat buffer. Gated at clan MEMBERSHIP; rate-limited 20/min per player; text is
 * server-sanitized + slur-filtered (cleanChatText). The display name and
 * timestamp are stamped SERVER-SIDE from the caller's save — never the body — so
 * a client can't spoof another member. Append runs under the per-clan lock so
 * concurrent posts don't clobber the ring buffer.
 *
 * Body: { playerName, clan, text }.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        if (!playerName || !clan)
            return res.status(400).json({ error: 'Missing playerName or clan.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only post as yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-chat', 20, 60_000, identity.name)))
            return;
        const slug = (0, _utils_js_1.clanBareSlug)(clan);
        if (!slug)
            return res.status(400).json({ error: 'Invalid clan name.' });
        const save = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = (save?.character ?? null);
        if (!identity.admin && (!char || (0, _utils_js_1.clanBareSlug)(String(char.clan ?? '')) !== slug)) {
            return res.status(403).json({ error: 'You are not a member of this clan.' });
        }
        const text = (0, _storage_js_2.cleanChatText)(body.text);
        if (!text)
            return res.status(400).json({ error: 'Message is empty or contains blocked content.' });
        const now = Date.now();
        const msg = { id: `${now}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: String(char?.name ?? playerName), text, ts: now };
        const key = (0, _storage_js_2.clanChatKey)(slug);
        const messages = await (0, _lock_js_1.withKvLock)(key, async () => {
            const existing = await _storage_js_1.kv.get(key);
            const next = (0, _storage_js_2.appendChatMessage)(existing, msg);
            await _storage_js_1.kv.set(key, next, { ex: _storage_js_2.CLAN_CHAT_TTL_SEC });
            return next;
        });
        return res.status(200).json({ ok: true, message: msg, messages });
    }
    catch (err) {
        console.error('[clan/chat/send]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
