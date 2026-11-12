/**
 * The names of Cinderhold's three clans, and nothing else: the client imports
 * this (the declare list, the 2v2 note), so it stays tiny. Membership lives in
 * shared/npc-clans.ts, which the client never loads.
 */
export const NPC_CLAN_NAMES: readonly string[] = Object.freeze(['Ashen Fang', 'Ember Ward', 'Obsidian Veil']);

/** Mirror of api/_utils.ts clanBareSlug (the clan-record key rule). */
export function npcClanBareSlug(name: unknown): string {
    return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether a clan name is one of Cinderhold's (reserved: no player clan may take it). */
export function isNpcClanName(name: unknown): boolean {
    const slug = npcClanBareSlug(name);
    return !!slug && NPC_CLAN_NAMES.some((clan) => npcClanBareSlug(clan) === slug);
}
