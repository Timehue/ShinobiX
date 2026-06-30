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
const MSG_TTL_MS = 60 * 60 * 1000; // 1 hour (matches battle session TTL)
const MAX_MESSAGES = 100;
const KV_TTL_SECONDS = 2 * 60 * 60; // 2-hour KV key TTL
function chatKey(battleId) {
    return `chat:battle:${battleId}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const battleId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!battleId)
        return res.status(400).json({ error: 'Missing battle id.' });
    const key = chatKey(battleId);
    if (req.method === 'GET') {
        // Auth gate: previously this was wide open and anyone who could
        // guess `pvp-<ms-epoch>-<5-base36>` could read private fighter +
        // spectator chat. Logged-in players only. (We could further restrict
        // to participants/spectators-of-this-battle, but that requires a
        // session lookup on every GET and the chat itself is short-lived
        // and low-stakes — the auth gate alone closes the unauthenticated
        // scrape vector that was the actual finding.)
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const messages = await _storage_js_1.kv.get(key) ?? [];
        const fresh = messages.filter(m => Date.now() - m.ts < MSG_TTL_MS);
        res.setHeader('X-Message-Count', String(fresh.length));
        // Expose X-Message-Count so cross-origin clients can read it (the client
        // uses it to skip re-parsing the body when the count is unchanged).
        res.setHeader('Access-Control-Expose-Headers', 'X-Message-Count');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(fresh);
    }
    if (req.method === 'POST') {
        // Cap chat posts at 20/min per IP — keeps the KV-lock R-M-W from
        // being a DOS vector while still allowing fast banter.
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pvp-chat-post', 20, 60_000)))
            return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { author, text } = body;
            if (!author || !text)
                return res.status(400).json({ error: 'Missing author or text.' });
            // Auth required so spectators can't impersonate fighters in battle chat.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, author);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            const authorNorm = (0, _utils_js_1.safeName)(author);
            if (!identity.admin && identity.name !== authorNorm) {
                return res.status(403).json({ error: 'Cannot post as another player.' });
            }
            // Silenced players can spectate / fight but not chat. Admin bypasses.
            if (!identity.admin) {
                const sil = await (0, moderation_js_1.getActiveSilence)(identity.name);
                if (sil) {
                    return res.status(403).json({
                        error: 'You are silenced.',
                        silence: { until: sil.until, reason: sil.reason },
                    });
                }
            }
            // Derive role from the session: if the author is one of the two
            // fighters, allow `fighter`; otherwise force `spectator` regardless
            // of what the body claimed.
            let derivedRole = 'spectator';
            let session = null;
            try {
                session = await _storage_js_1.kv.get(`pvp:${battleId}`);
            }
            catch (err) {
                // Session lookup FAILED (KV error). We can't tell whether the
                // author is a fighter or a spectator, so don't silently mislabel
                // them as a spectator (audit #8 — that swallowed the error and
                // posted a fighter's line tagged 'spectator'). Reject so the
                // client retries. NOTE: a genuinely-missing session (null below,
                // e.g. post-battle banter after the 15-min session TTL lapses
                // while the 2-hour chat key lives on) is NOT an error — it
                // legitimately resolves to 'spectator'.
                console.error('[pvp/chat] session lookup failed', err);
                return res.status(503).json({ error: 'Could not verify battle role — please retry.' });
            }
            if (session) {
                const p1Norm = (0, _utils_js_1.safeName)(String(session.p1?.name ?? ''));
                const p2Norm = (0, _utils_js_1.safeName)(String(session.p2?.name ?? ''));
                if (authorNorm === p1Norm || authorNorm === p2Norm) {
                    derivedRole = 'fighter';
                }
            }
            // Moderate before persisting — masks profanity, redacts PII,
            // caps length. Empty post after sanitization is rejected so
            // the chat log doesn't carry blank lines.
            const safeText = identity.admin ? text.slice(0, _text_moderation_js_1.TEXT_LIMITS.chatMessage) : (0, _text_moderation_js_1.sanitizeUserText)(text, _text_moderation_js_1.TEXT_LIMITS.chatMessage);
            if (!safeText)
                return res.status(400).json({ error: 'Empty message after moderation.' });
            const newMsg = {
                author,
                text: safeText,
                ts: Date.now(),
                role: derivedRole,
            };
            // Read-modify-write under a short KV lock so spectators + fighters
            // posting at the same time can't overwrite each other's lines.
            const updated = await (0, _lock_js_1.withKvLock)(key, async () => {
                const existing = await _storage_js_1.kv.get(key) ?? [];
                const fresh = existing.filter(m => Date.now() - m.ts < MSG_TTL_MS);
                const next = [...fresh, newMsg].slice(-MAX_MESSAGES);
                await _storage_js_1.kv.set(key, next, { ex: KV_TTL_SECONDS });
                return next;
            });
            return res.status(200).json(updated);
        }
        catch (err) {
            console.error('[pvp/chat]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
