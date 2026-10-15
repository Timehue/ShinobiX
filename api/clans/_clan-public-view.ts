import { kv } from '../_storage.js';
import { readKvProjection } from '../_storage-projection.js';
import { clanBareSlug } from '../_utils.js';

/*
 * What a player who is NOT in a clan may see of that clan's shared record
 * (`save:clan-<slug>`, legacy `clan:<slug>`). Members and admins keep the full
 * row; everyone else gets this allowlist, so treasury, settlement receipts,
 * role appointments, notices, war state, upgrade levels, campaign journals and
 * any future server field stay private unless they are named here.
 *
 * Every field is one the client reads from ANOTHER clan's record:
 *   - Clan Hall browse (ClanHall.tsx): name, image, village, level, members,
 *     founderName, doctrine, recruitment, joinRequests.
 *   - Clan Rankings (ClanRankings.tsx, shared/clan-campaign-standings.ts):
 *     name, image, village, level, members, doctrine, campaignPrestige.
 *   - Arena clan-war opponent (Arena.tsx): name, members.
 *   - Create/reclaim existence checks: any non-null row.
 *
 * joinRequests stays visible on purpose: a join request is sent by re-posting
 * the clan's current joinRequests with the caller's entry appended, and the
 * clan validator (api/_clan-save-validate.ts) reverts a list that drops another
 * player's request. Each entry has the same shape as a public `members` entry.
 * Every field left out of this view is pinned to its stored value by that
 * validator when a non-member's join-request write echoes the view back.
 */
export const CLAN_PUBLIC_FIELDS = [
    'name',
    'village',
    'founderName',
    'image',
    'doctrine',
    'recruitment',
    'createdAt',
    'members',
    'level',
    'xp',
    'campaignPrestige',
    'joinRequests',
] as const;

export function clanPublicView(record: unknown): Record<string, unknown> | null {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const source = record as Record<string, unknown>;
    const view: Record<string, unknown> = {};
    for (const field of CLAN_PUBLIC_FIELDS) {
        if (source[field] !== undefined) view[field] = source[field];
    }
    return view;
}

/** The bare slug of the clan the player's own save names, or '' for none. */
export async function playerClanSlug(playerName: string): Promise<string> {
    if (!playerName) return '';
    const [row] = await readKvProjection(kv, [`save:${playerName}`], { clan: ['character', 'clan'] });
    return clanBareSlug(String(row?.clan ?? ''));
}

/** Bare slug of a clan record (`save:clan-<slug>` row or its name). */
export function clanRecordSlug(record: unknown): string {
    if (!record || typeof record !== 'object') return '';
    return clanBareSlug(String((record as Record<string, unknown>).name ?? ''));
}
