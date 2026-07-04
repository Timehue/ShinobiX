import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, clanBareSlug } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { clanChatKey, appendChatMessage, cleanChatText, CLAN_CHAT_TTL_SEC, type ClanChatMessage } from './_storage.js';

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
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        if (!playerName || !clan) return res.status(400).json({ error: 'Missing playerName or clan.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only post as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-chat', 20, 60_000, identity.name))) return;

        const slug = clanBareSlug(clan);
        if (!slug) return res.status(400).json({ error: 'Invalid clan name.' });

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (save?.character ?? null) as Record<string, unknown> | null;
        if (!identity.admin && (!char || clanBareSlug(String(char.clan ?? '')) !== slug)) {
            return res.status(403).json({ error: 'You are not a member of this clan.' });
        }

        const text = cleanChatText(body.text);
        if (!text) return res.status(400).json({ error: 'Message is empty or contains blocked content.' });

        const now = Date.now();
        const msg: ClanChatMessage = { id: `${now}-${randomUUID().slice(0, 8)}`, name: String(char?.name ?? playerName), text, ts: now };
        const key = clanChatKey(slug);
        const messages = await withKvLock(key, async () => {
            const existing = await kv.get<ClanChatMessage[]>(key);
            const next = appendChatMessage(existing, msg);
            await kv.set(key, next, { ex: CLAN_CHAT_TTL_SEC });
            return next;
        });

        return res.status(200).json({ ok: true, message: msg, messages });
    } catch (err) {
        console.error('[clan/chat/send]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
