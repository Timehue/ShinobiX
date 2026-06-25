"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const moderation_js_1 = require("../admin/moderation.js");
const _lock_js_1 = require("../_lock.js");
const _text_moderation_js_1 = require("../_text-moderation.js");
// Max length of the quoted snippet we persist for a reply. Short — it's a
// preview, not the full message; the client ellipsizes anything longer.
const REPLY_SNIPPET_LIMIT = 140;
const MAX_MESSAGES = 30; // hold the most recent 30 messages; the oldest drops as new ones arrive (count-based, no age expiry)
const KV_TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day KV key TTL (refreshed on every POST) — only garbage-collects truly abandoned villages, not active chat
function chatKey(village) {
    return `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';
    if (!village)
        return res.status(400).json({ error: 'Missing village.' });
    const key = chatKey(village);
    if (req.method === 'GET') {
        // Auth gate: village chat used to be scrapeable anonymously (just
        // guess the village name from the hardcoded client list). Logged-in
        // players only. Server-side reads are unaffected because they go
        // through the service-role key, not this endpoint.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const messages = await _storage_js_1.kv.get(key) ?? [];
        res.setHeader('X-Message-Count', String(messages.length));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(messages);
    }
    if (req.method === 'POST') {
        // Cap chat posts at 20/min per IP — keeps the KV-lock R-M-W
        // from being a DOS vector while leaving room for fast banter.
        // Matches the PvP chat ceiling.
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-chat-post', 20, 60_000)))
            return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { author, text, replyTo } = body;
            if (!author || !text)
                return res.status(400).json({ error: 'Missing author or text.' });
            // Authenticate the author so trolls can't impersonate the Kage
            // (or anyone else) in village chat.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, author);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(author)) {
                return res.status(403).json({ error: 'Cannot post as another player.' });
            }
            // Silenced players can read but not post. Admin bypasses.
            if (!identity.admin) {
                const sil = await (0, moderation_js_1.getActiveSilence)(identity.name);
                if (sil) {
                    return res.status(403).json({
                        error: 'You are silenced.',
                        silence: { until: sil.until, reason: sil.reason },
                    });
                }
            }
            // Derive rank/customTitle/level from the authed player's save so they
            // can't be spoofed via the request body (no posing as "Kage" etc.).
            let derivedRank;
            let derivedCustomTitle;
            let derivedLevel;
            if (!identity.admin) {
                try {
                    const save = await _storage_js_1.kv.get(`save:${identity.name}`);
                    const char = (save?.character ?? null);
                    if (char) {
                        if (typeof char.rank === 'string')
                            derivedRank = char.rank;
                        if (typeof char.customTitle === 'string')
                            derivedCustomTitle = char.customTitle;
                        if (typeof char.level === 'number')
                            derivedLevel = char.level;
                    }
                }
                catch {
                    // Best effort — fall through with no derived fields.
                }
            }
            // Moderate + length-cap before persisting. Profanity is masked
            // with asterisks; PII patterns are redacted. Admins bypass so
            // they can still send command-style messages with URLs.
            const safeText = identity.admin ? text.slice(0, _text_moderation_js_1.TEXT_LIMITS.chatMessage) : (0, _text_moderation_js_1.sanitizeUserText)(text, _text_moderation_js_1.TEXT_LIMITS.chatMessage);
            if (!safeText)
                return res.status(400).json({ error: 'Empty message after moderation.' });
            // Optional reply quote. Display-only and not security-sensitive, but
            // run the snippet through the same moderation as any user text so a
            // reply can't smuggle profanity/PII past the filter or bloat KV.
            let replyRef;
            if (replyTo && typeof replyTo === 'object') {
                const rAuthor = (0, _text_moderation_js_1.sanitizeUserText)(replyTo.author, _text_moderation_js_1.TEXT_LIMITS.customTitle);
                const rText = (0, _text_moderation_js_1.sanitizeUserText)(replyTo.text, REPLY_SNIPPET_LIMIT);
                if (rAuthor && rText)
                    replyRef = { author: rAuthor, text: rText };
            }
            const newMsg = {
                author,
                text: safeText,
                ts: Date.now(),
                ...(derivedRank ? { rank: derivedRank } : {}),
                ...(derivedCustomTitle ? { customTitle: derivedCustomTitle } : {}),
                ...(derivedLevel != null ? { level: derivedLevel } : {}),
                ...(replyRef ? { replyTo: replyRef } : {}),
            };
            // Read-modify-write under a short-lived KV lock so two concurrent
            // posters can't silently overwrite each other's message. Lock TTL
            // is bounded so a crashed lambda releases the key after a second
            // or two; under sustained contention (lock acquire fails) we fall
            // through and run unlocked rather than dropping the write.
            const updated = await (0, _lock_js_1.withKvLock)(key, async () => {
                const existing = await _storage_js_1.kv.get(key) ?? [];
                const next = [...existing, newMsg].slice(-MAX_MESSAGES);
                await _storage_js_1.kv.set(key, next, { ex: KV_TTL_SECONDS });
                return next;
            });
            return res.status(200).json(updated);
        }
        catch (err) {
            console.error('[village/chat]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
