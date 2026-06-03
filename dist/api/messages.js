"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.threadKey = threadKey;
exports.upsertInbox = upsertInbox;
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const moderation_js_1 = require("./admin/moderation.js");
const _lock_js_1 = require("./_lock.js");
const _text_moderation_js_1 = require("./_text-moderation.js");
const THREAD_MAX = 200; // messages kept per conversation
const INBOX_MAX = 60; // conversations kept per inbox
const KV_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
function norm(name) {
    return String(name ?? '').toLowerCase().trim();
}
// Stable thread key for a pair of players, independent of who sends.
function threadKey(a, b) {
    const [x, y] = [norm(a), norm(b)].sort();
    return `dm:thread:${x}|${y}`;
}
function inboxKey(user) {
    return `dm:inbox:${norm(user)}`;
}
// Move/insert a conversation summary to the front of an inbox, de-duped by
// partner, newest-first, capped. Pure so it can be unit-tested.
function upsertInbox(inbox, entry, max = INBOX_MAX) {
    const rest = (Array.isArray(inbox) ? inbox : []).filter((e) => norm(e.with) !== norm(entry.with));
    return [entry, ...rest].sort((p, q) => q.lastTs - p.lastTs).slice(0, max);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (identity.admin)
            return res.status(403).json({ error: 'Direct messages require a player account.' });
        const me = identity.name;
        const withName = typeof req.query.with === 'string' ? norm(req.query.with) : '';
        res.setHeader('Cache-Control', 'no-store');
        if (!withName) {
            const inbox = (await _storage_js_1.kv.get(inboxKey(me))) ?? [];
            return res.status(200).json(inbox);
        }
        // Reading a thread clears its unread badge in MY inbox.
        const messages = (await _storage_js_1.kv.get(threadKey(me, withName))) ?? [];
        try {
            await (0, _lock_js_1.withKvLock)(inboxKey(me), async () => {
                const inbox = (await _storage_js_1.kv.get(inboxKey(me))) ?? [];
                let changed = false;
                const next = inbox.map((e) => {
                    if (norm(e.with) === withName && e.unread > 0) {
                        changed = true;
                        return { ...e, unread: 0 };
                    }
                    return e;
                });
                if (changed)
                    await _storage_js_1.kv.set(inboxKey(me), next, { ex: KV_TTL_SECONDS });
            });
        }
        catch { /* best-effort read-receipt; never fail the read */ }
        return res.status(200).json(messages);
    }
    if (req.method === 'POST') {
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'dm-send', 20, 60_000)))
            return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { to, text } = body;
            if (!to || !text)
                return res.status(400).json({ error: 'Missing recipient or text.' });
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            if (identity.admin)
                return res.status(403).json({ error: 'Direct messages require a player account.' });
            const from = identity.name;
            const recipient = norm(to);
            if (recipient === from)
                return res.status(400).json({ error: 'Cannot message yourself.' });
            // Silenced players can read but not send.
            const sil = await (0, moderation_js_1.getActiveSilence)(from);
            if (sil)
                return res.status(403).json({ error: 'You are silenced.', silence: { until: sil.until, reason: sil.reason } });
            // Recipient must be a real player (avoids junk threads / typos).
            const recipientSave = await _storage_js_1.kv.get(`save:${recipient}`);
            if (!recipientSave)
                return res.status(404).json({ error: 'No such player.' });
            const safeText = (0, _text_moderation_js_1.sanitizeUserText)(text, _text_moderation_js_1.TEXT_LIMITS.chatMessage);
            if (!safeText)
                return res.status(400).json({ error: 'Empty message after moderation.' });
            const ts = Date.now();
            const msg = { from, text: safeText, ts };
            // Append to the shared thread under its lock.
            const tKey = threadKey(from, recipient);
            const thread = await (0, _lock_js_1.withKvLock)(tKey, async () => {
                const existing = (await _storage_js_1.kv.get(tKey)) ?? [];
                const next = [...existing, msg].slice(-THREAD_MAX);
                await _storage_js_1.kv.set(tKey, next, { ex: KV_TTL_SECONDS });
                return next;
            });
            // Update both inboxes: recipient gets an unread bump; sender's own
            // copy is marked read (they're looking at it).
            await (0, _lock_js_1.withKvLock)(inboxKey(recipient), async () => {
                const inbox = (await _storage_js_1.kv.get(inboxKey(recipient))) ?? [];
                const prevUnread = inbox.find((e) => norm(e.with) === from)?.unread ?? 0;
                await _storage_js_1.kv.set(inboxKey(recipient), upsertInbox(inbox, { with: from, lastTs: ts, lastText: safeText, unread: prevUnread + 1 }), { ex: KV_TTL_SECONDS });
            });
            await (0, _lock_js_1.withKvLock)(inboxKey(from), async () => {
                const inbox = (await _storage_js_1.kv.get(inboxKey(from))) ?? [];
                await _storage_js_1.kv.set(inboxKey(from), upsertInbox(inbox, { with: recipient, lastTs: ts, lastText: safeText, unread: 0 }), { ex: KV_TTL_SECONDS });
            });
            return res.status(200).json(thread);
        }
        catch (err) {
            console.error('[messages]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
