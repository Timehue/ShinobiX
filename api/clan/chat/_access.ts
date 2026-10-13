import { kv } from '../../_storage.js';
import { readKvProjection } from '../../_storage-projection.js';
import { clanBareSlug } from '../../_utils.js';

/*
 * Clan chat membership: the player's own save names this clan. One rule for
 * the GET (api/clan/chat/get.ts) and the socket subscribe
 * (api/_realtime/chat-rooms.ts), so the socket can never reach a reader the
 * transcript would refuse. Admin exemption stays with the HTTP caller.
 */
export async function isClanChatMember(playerName: string, slug: string): Promise<boolean> {
    // Runs for every subscribed member after each new line: read the one
    // field it needs, not the whole save row.
    const [row] = await readKvProjection(kv, [`save:${playerName}`], { clan: ['character', 'clan'] });
    return !!row && Object.keys(row).length > 0 && clanBareSlug(String(row.clan ?? '')) === slug;
}
