import { kv } from '../../_storage.js';
import { clanBareSlug } from '../../_utils.js';

/*
 * Clan chat membership: the player's own save names this clan. One rule for
 * the GET (api/clan/chat/get.ts) and the socket subscribe
 * (api/_realtime/chat-rooms.ts), so the socket can never reach a reader the
 * transcript would refuse. Admin exemption stays with the HTTP caller.
 */
export async function isClanChatMember(playerName: string, slug: string): Promise<boolean> {
    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
    const char = (save?.character ?? null) as Record<string, unknown> | null;
    return !!char && clanBareSlug(String(char.clan ?? '')) === slug;
}
