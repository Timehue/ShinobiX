import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { safeLogValue } from '../_safe-log.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { rejectUnclaimedGuest } from '../_guest-gate.js';
import { getActiveSilence } from '../admin/moderation.js';
import { blockedPlayersFor } from '../player/_blocks.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { sectorChatEnabled } from '../_release-flags.js';
import { onlineStore } from '../_realtime/online-store.js';
import { kickSectorChat } from '../_realtime/notify.js';
import {
    freshSectorChat,
    isSectorChatSector,
    sectorChatSince,
    SECTOR_CHAT_POSTS_PER_MINUTE,
    type SectorChatMessage,
} from '../../shared/sector-chat.js';
import {
    appendSectorChat,
    cleanSectorChatText,
    sectorChatKey,
    SECTOR_CHAT_TTL_SEC,
    withoutBlockedAuthors,
} from './_chat.js';

/*
 * /api/sector/chat — the voice of the sector you are standing in.
 *
 *   GET  ?sector=<n>&since=<ms>   lines newer than the cursor, minus authors the
 *                                 reader has blocked.
 *   POST { sector, text }         say something to everyone in that sector.
 *
 * Both directions require LIVE presence in the sector, by the same rule the
 * field rewards and attacks use (sectorPresenceBlock): you hear and are heard
 * where you actually stand. A reader who is not there gets an empty list with
 * `away` set; a speaker who is not there gets a 409. The author's name and village are stamped from the
 * authenticated presence record, never the body, so nobody can speak as
 * someone else. After a post, everyone in the sector's socket room gets a hint
 * to refetch; the text itself never rides the socket, so each reader's block
 * list still applies.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!sectorChatEnabled()) return res.status(404).json({ error: 'Sector chat is unavailable.', disabled: true });

    try {
        const body = req.method === 'POST'
            ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>
            : {};
        const sector = Number(req.method === 'GET' ? req.query.sector : body.sector);
        if (!isSectorChatSector(sector)) return res.status(400).json({ error: 'That place has no sector chat.' });

        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });

        if (req.method === 'GET') return await read(req, res, sector, identity);
        if (identity.admin) return res.status(403).json({ error: 'Sign in as a player to speak in a sector.' });
        return await post(req, res, sector, identity, body.text);
    } catch (err) {
        console.error('[sector/chat]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

async function read(
    req: VercelRequest,
    res: VercelResponse,
    sector: number,
    identity: { admin: true } | { admin: false; name: string },
) {
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-store');
    if (!identity.admin) {
        // Out of earshot reads as silence, not as an error: the panel polls
        // from the moment the sector opens, often a beat before presence
        // settles, and a 409 there would only be console noise. Nothing from
        // the sector is returned. Speaking still refuses with the 409 below.
        const away = sectorPresenceBlock(identity.name, sector);
        if (away) return res.status(200).json({ messages: [], now, away: away.reason });
    }
    const since = Math.max(0, Math.floor(Number(req.query.since ?? 0)) || 0);
    const live = sectorChatSince(freshSectorChat(await kv.get<SectorChatMessage[]>(sectorChatKey(sector)), now), since);
    // Most polls find nothing new; only read the block list when there is
    // something it could hide.
    const visible = identity.admin || !live.length ? live : withoutBlockedAuthors(live, await blockedPlayersFor(identity.name));
    return res.status(200).json({ messages: visible, now });
}

async function post(
    req: VercelRequest,
    res: VercelResponse,
    sector: number,
    identity: { admin: false; name: string },
    rawText: unknown,
) {
    const { name } = identity;
    // Rate limit after auth, keyed to the verified player, like the other chats:
    // per address it would be shared by a household, and a pre-auth name key
    // could be spent by anyone.
    if (!(await enforceRateLimitKv(req, res, 'sector-chat-post', SECTOR_CHAT_POSTS_PER_MINUTE, 60_000, name))) return;
    // Listening stays open to unclaimed guests; speaking to strangers does not.
    if (await rejectUnclaimedGuest(res, identity)) return;
    const silence = await getActiveSilence(name);
    if (silence) return res.status(403).json({ error: 'You are silenced.', silence: { until: silence.until, reason: silence.reason } });
    const away = sectorPresenceBlock(name, sector);
    if (away) return res.status(away.status).json({ error: away.error, reason: away.reason });

    const text = cleanSectorChatText(rawText);
    if (!text) return res.status(400).json({ error: 'Message is empty or contains blocked content.' });

    const presence = onlineStore.get(name);
    const character = (presence?.character ?? null) as Record<string, unknown> | null;
    const displayName = presence?.displayName && safeName(presence.displayName) === name ? presence.displayName : name;
    const village = typeof character?.village === 'string' && character.village ? character.village : undefined;
    const level = Number(character?.level);
    const now = Date.now();
    const message: SectorChatMessage = {
        id: `${now}-${randomUUID().slice(0, 8)}`,
        name: displayName,
        text,
        ts: now,
        ...(village ? { village } : {}),
        ...(Number.isInteger(level) && level > 0 ? { level } : {}),
    };

    const key = sectorChatKey(sector);
    await withKvLock(key, async () => {
        const existing = await kv.get<SectorChatMessage[]>(key);
        await kv.set(key, appendSectorChat(existing, message, now), { ex: SECTOR_CHAT_TTL_SEC });
    });
    kickSectorChat(sector, now);
    return res.status(200).json({ ok: true, message });
}
