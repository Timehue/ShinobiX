import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { getActiveSilence } from './admin/moderation.js';
import { withKvLock } from './_lock.js';
import { sanitizeUserText, TEXT_LIMITS } from './_text-moderation.js';

/*
 * /api/messages — player-to-player direct messages (mail).
 *
 * Reuses the same trust model as village chat (api/village/chat.ts): the sender
 * is the AUTHED player (never trusted from the body), text is run through
 * sanitizeUserText, silenced players can read but not send, posts are
 * rate-limited, and the read-modify-write runs under a KV lock so two concurrent
 * sends to the same thread can't clobber each other. Polling-based (no realtime)
 * so there is no Supabase schema change.
 *
 *   GET  /api/messages              -> my inbox (conversation summaries)
 *   GET  /api/messages?with=<name>  -> the thread with <name> (marks it read)
 *   POST /api/messages  { to, text} -> send a message (sender = authed player)
 */

export type DmMessage = { from: string; text: string; ts: number };
export type InboxEntry = { with: string; lastTs: number; lastText: string; unread: number };

const THREAD_MAX = 200;       // messages kept per conversation
const INBOX_MAX = 60;         // conversations kept per inbox
const KV_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function norm(name: string): string {
    return String(name ?? '').toLowerCase().trim();
}

// Stable thread key for a pair of players, independent of who sends.
export function threadKey(a: string, b: string): string {
    const [x, y] = [norm(a), norm(b)].sort();
    return `dm:thread:${x}|${y}`;
}
function inboxKey(user: string): string {
    return `dm:inbox:${norm(user)}`;
}

// Move/insert a conversation summary to the front of an inbox, de-duped by
// partner, newest-first, capped. Pure so it can be unit-tested.
export function upsertInbox(inbox: InboxEntry[], entry: InboxEntry, max = INBOX_MAX): InboxEntry[] {
    const rest = (Array.isArray(inbox) ? inbox : []).filter((e) => norm(e.with) !== norm(entry.with));
    return [entry, ...rest].sort((p, q) => q.lastTs - p.lastTs).slice(0, max);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (identity.admin) return res.status(403).json({ error: 'Direct messages require a player account.' });
        const me = identity.name;
        const withName = typeof req.query.with === 'string' ? norm(req.query.with) : '';

        res.setHeader('Cache-Control', 'no-store');

        if (!withName) {
            const inbox = (await kv.get<InboxEntry[]>(inboxKey(me))) ?? [];
            return res.status(200).json(inbox);
        }

        // Reading a thread clears its unread badge in MY inbox.
        const messages = (await kv.get<DmMessage[]>(threadKey(me, withName))) ?? [];
        try {
            await withKvLock(inboxKey(me), async () => {
                const inbox = (await kv.get<InboxEntry[]>(inboxKey(me))) ?? [];
                let changed = false;
                const next = inbox.map((e) => {
                    if (norm(e.with) === withName && e.unread > 0) { changed = true; return { ...e, unread: 0 }; }
                    return e;
                });
                if (changed) await kv.set(inboxKey(me), next, { ex: KV_TTL_SECONDS });
            });
        } catch { /* best-effort read-receipt; never fail the read */ }

        return res.status(200).json(messages);
    }

    if (req.method === 'POST') {
        if (!(await enforceRateLimitKv(req, res, 'dm-send', 20, 60_000))) return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { to, text } = body as { to?: string; text?: string };
            if (!to || !text) return res.status(400).json({ error: 'Missing recipient or text.' });

            const identity = await authedPlayerOrAdmin(req);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (identity.admin) return res.status(403).json({ error: 'Direct messages require a player account.' });
            const from = identity.name;
            const recipient = norm(to);
            if (recipient === from) return res.status(400).json({ error: 'Cannot message yourself.' });

            // Silenced players can read but not send.
            const sil = await getActiveSilence(from);
            if (sil) return res.status(403).json({ error: 'You are silenced.', silence: { until: sil.until, reason: sil.reason } });

            // Recipient must be a real player (avoids junk threads / typos).
            const recipientSave = await kv.get<Record<string, unknown>>(`save:${recipient}`);
            if (!recipientSave) return res.status(404).json({ error: 'No such player.' });

            const safeText = sanitizeUserText(text, TEXT_LIMITS.chatMessage);
            if (!safeText) return res.status(400).json({ error: 'Empty message after moderation.' });

            const ts = Date.now();
            const msg: DmMessage = { from, text: safeText, ts };

            // Append to the shared thread under its lock.
            const tKey = threadKey(from, recipient);
            const thread = await withKvLock(tKey, async () => {
                const existing = (await kv.get<DmMessage[]>(tKey)) ?? [];
                const next = [...existing, msg].slice(-THREAD_MAX);
                await kv.set(tKey, next, { ex: KV_TTL_SECONDS });
                return next;
            });

            // Update both inboxes: recipient gets an unread bump; sender's own
            // copy is marked read (they're looking at it).
            await withKvLock(inboxKey(recipient), async () => {
                const inbox = (await kv.get<InboxEntry[]>(inboxKey(recipient))) ?? [];
                const prevUnread = inbox.find((e) => norm(e.with) === from)?.unread ?? 0;
                await kv.set(inboxKey(recipient), upsertInbox(inbox, { with: from, lastTs: ts, lastText: safeText, unread: prevUnread + 1 }), { ex: KV_TTL_SECONDS });
            });
            await withKvLock(inboxKey(from), async () => {
                const inbox = (await kv.get<InboxEntry[]>(inboxKey(from))) ?? [];
                await kv.set(inboxKey(from), upsertInbox(inbox, { with: recipient, lastTs: ts, lastText: safeText, unread: 0 }), { ex: KV_TTL_SECONDS });
            });

            return res.status(200).json(thread);
        } catch (err) {
            console.error('[messages]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
