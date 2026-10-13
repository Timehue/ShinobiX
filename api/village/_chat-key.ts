// The village tavern transcript (`chat:village:<slug>`) has three writers:
// player posts (api/village/chat.ts), World Herald lines (api/_announce.ts) and
// the moderator delete (api/admin/moderation.ts). Each rewrites the whole blob
// with `kv.set(..., { ex })`, so each resets the expiry of the WHOLE transcript —
// they must all agree on it, or one writer silently shortens everyone's history.
// _announce.ts still spells the value as its own literal; chat-ttl-parity.test.ts
// holds it to this constant.

/** 30-day KV key TTL (refreshed on every write) — only garbage-collects truly
 *  abandoned villages, not active chat. */
export const VILLAGE_CHAT_TTL_SECONDS = 30 * 24 * 60 * 60;

export function villageChatKey(village: string): string {
    return `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
