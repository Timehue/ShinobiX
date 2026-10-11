/*
 * Chat push — the socket contract for the village tavern and clan chat.
 *
 * The socket carries a HINT, never a line. A reader whose tavern or clan chat is
 * open subscribes to that room; when the room's chat changes, the server emits
 * `{ channel, key, ts }` and each reader refetches through the HTTP endpoint,
 * which stays the only source of truth. That keeps every per-reader rule where
 * it already lives: the tavern GET filters out authors the reader has blocked
 * and refuses unclaimed guests, so broadcasting the text itself would show a
 * blocked author's line to the person who blocked them (same reasoning as
 * shared/sector-chat.ts).
 */

/** Server → client: a subscribed room's chat has something new to fetch. */
export const CHAT_PUSH_EVENT = 'chat:push';
/** Client → server (acknowledged): start hearing a room's hints. */
export const CHAT_SUBSCRIBE_EVENT = 'chat:subscribe';
/** Client → server: stop hearing a room's hints. */
export const CHAT_UNSUBSCRIBE_EVENT = 'chat:unsubscribe';

export type ChatPushChannel = 'village' | 'clan';

export type ChatPush = { channel: ChatPushChannel; key: string; ts: number };

export type ChatSubscribeResult =
    | { ok: true }
    | { ok: false; reason: 'invalid' | 'forbidden' | 'throttled' | 'unavailable' };

/** Longest village or clan name a subscribe request may carry. */
const MAX_CHAT_PUSH_NAME = 80;

/**
 * The tavern's room slug: EXACTLY the rule api/village/chat.ts uses for its
 * `chat:village:<slug>` storage key, so a hint names the same room the reader's
 * GET reads. Callers trim first, as the handler does.
 */
export function villageChatSlug(village: string): string {
    return village.toLowerCase().replace(/\s+/g, '-');
}

/** The clan chat's room slug: api/_utils.ts clanBareSlug ("Storm Clan" → "stormclan"). */
export function clanChatSlug(clan: string): string {
    return clan.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function chatPushSlug(channel: ChatPushChannel, name: string): string {
    return channel === 'village' ? villageChatSlug(name.trim()) : clanChatSlug(name);
}

/** Socket.IO room for one chat. Prefixed so it can never collide with `user:` or `sector:` rooms. */
export function chatPushRoom(channel: ChatPushChannel, slug: string): string {
    return `chat-push:${channel}:${slug}`;
}

/** Validate a subscribe/unsubscribe payload: a known channel and a usable, bounded name. */
export function parseChatPushRequest(payload: unknown): { channel: ChatPushChannel; name: string; slug: string } | null {
    if (!payload || typeof payload !== 'object') return null;
    const { channel, key } = payload as { channel?: unknown; key?: unknown };
    if (channel !== 'village' && channel !== 'clan') return null;
    if (typeof key !== 'string') return null;
    const name = key.trim();
    if (!name || name.length > MAX_CHAT_PUSH_NAME) return null;
    const slug = chatPushSlug(channel, name);
    return slug ? { channel, name, slug } : null;
}

/** Validate a hint as it arrives on the client. */
export function parseChatPush(payload: unknown): ChatPush | null {
    if (!payload || typeof payload !== 'object') return null;
    const { channel, key, ts } = payload as { channel?: unknown; key?: unknown; ts?: unknown };
    if (channel !== 'village' && channel !== 'clan') return null;
    if (typeof key !== 'string' || !key) return null;
    return { channel, key, ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : 0 };
}
