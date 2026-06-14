import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { getActiveSilence } from '../admin/moderation.js';
import { withKvLock } from '../_lock.js';
import { sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';

type ChatMessage = {
    author: string;
    text: string;
    ts: number;
    rank?: string;
    customTitle?: string;
    level?: number;
};

const MAX_MESSAGES = 30; // hold the most recent 30 messages; the oldest drops as new ones arrive (count-based, no age expiry)
const KV_TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day KV key TTL (refreshed on every POST) — only garbage-collects truly abandoned villages, not active chat

function chatKey(village: string): string {
    return `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';
    if (!village) return res.status(400).json({ error: 'Missing village.' });

    const key = chatKey(village);

    if (req.method === 'GET') {
        // Auth gate: village chat used to be scrapeable anonymously (just
        // guess the village name from the hardcoded client list). Logged-in
        // players only. Server-side reads are unaffected because they go
        // through the service-role key, not this endpoint.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const messages = await kv.get<ChatMessage[]>(key) ?? [];
        res.setHeader('X-Message-Count', String(messages.length));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(messages);
    }

    if (req.method === 'POST') {
        // Cap chat posts at 20/min per IP — keeps the KV-lock R-M-W
        // from being a DOS vector while leaving room for fast banter.
        // Matches the PvP chat ceiling.
        if (!(await enforceRateLimitKv(req, res, 'village-chat-post', 20, 60_000))) return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { author, text } = body as {
                author?: string;
                text?: string;
            };
            if (!author || !text) return res.status(400).json({ error: 'Missing author or text.' });

            // Authenticate the author so trolls can't impersonate the Kage
            // (or anyone else) in village chat.
            const identity = await authedPlayerOrAdmin(req, author);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== safeName(author)) {
                return res.status(403).json({ error: 'Cannot post as another player.' });
            }

            // Silenced players can read but not post. Admin bypasses.
            if (!identity.admin) {
                const sil = await getActiveSilence(identity.name);
                if (sil) {
                    return res.status(403).json({
                        error: 'You are silenced.',
                        silence: { until: sil.until, reason: sil.reason },
                    });
                }
            }

            // Derive rank/customTitle/level from the authed player's save so they
            // can't be spoofed via the request body (no posing as "Kage" etc.).
            let derivedRank: string | undefined;
            let derivedCustomTitle: string | undefined;
            let derivedLevel: number | undefined;
            if (!identity.admin) {
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (char) {
                        if (typeof char.rank === 'string') derivedRank = char.rank;
                        if (typeof char.customTitle === 'string') derivedCustomTitle = char.customTitle;
                        if (typeof char.level === 'number') derivedLevel = char.level;
                    }
                } catch {
                    // Best effort — fall through with no derived fields.
                }
            }

            // Moderate + length-cap before persisting. Profanity is masked
            // with asterisks; PII patterns are redacted. Admins bypass so
            // they can still send command-style messages with URLs.
            const safeText = identity.admin ? text.slice(0, TEXT_LIMITS.chatMessage) : sanitizeUserText(text, TEXT_LIMITS.chatMessage);
            if (!safeText) return res.status(400).json({ error: 'Empty message after moderation.' });

            const newMsg: ChatMessage = {
                author,
                text: safeText,
                ts: Date.now(),
                ...(derivedRank        ? { rank: derivedRank }              : {}),
                ...(derivedCustomTitle ? { customTitle: derivedCustomTitle } : {}),
                ...(derivedLevel != null ? { level: derivedLevel }          : {}),
            };

            // Read-modify-write under a short-lived KV lock so two concurrent
            // posters can't silently overwrite each other's message. Lock TTL
            // is bounded so a crashed lambda releases the key after a second
            // or two; under sustained contention (lock acquire fails) we fall
            // through and run unlocked rather than dropping the write.
            const updated = await withKvLock(key, async () => {
                const existing = await kv.get<ChatMessage[]>(key) ?? [];
                const next = [...existing, newMsg].slice(-MAX_MESSAGES);
                await kv.set(key, next, { ex: KV_TTL_SECONDS });
                return next;
            });

            return res.status(200).json(updated);
        } catch (err) {
            console.error('[village/chat]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
