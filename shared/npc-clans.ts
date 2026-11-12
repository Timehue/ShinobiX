/**
 * Cinderhold's three permanent clans (owner rulings 2026-11-10).
 *
 * Ten of Cinderhold's thirty NPC shinobi (shared/npc-village-roster.ts) belong
 * to each clan, every clan mixing ranks: one Commander as founder and leader,
 * its Elites as officers, then Jonin, Chunin and Genin. The seeder
 * (api/_npc-village-seed.ts seedNpcClans) writes each clan record to storage
 * and each member's character.clan; nobody else can ever join one.
 *
 * Slugs only, no roster import. The client never loads this file: it needs
 * only the names, from shared/npc-clan-names.ts. shared/npc-clans.test.ts
 * proves every slug and rank against the roster, and that the two name lists
 * agree.
 */

export type NpcClan = {
    /** The clan's display name: its record is `save:clan-<bare slug>`. */
    name: string;
    /** The founder's account slug (a Commander): character.clanFounder, the record's founderName. */
    founder: string;
    /** Account slugs appointed Officer in the record's roleOverrides (its Elites). */
    officers: readonly string[];
    /** All ten account slugs, founder first. */
    members: readonly string[];
};

export const NPC_CLANS: readonly NpcClan[] = Object.freeze([
    {
        name: 'Ashen Fang',
        founder: 'kuroto',
        officers: ['kat', 'raku'],
        members: ['kuroto', 'kat', 'raku', 'mizuki', 'sly', 'tavi', 'sayo', 'veyl', 'riven', 'vesper'],
    },
    {
        name: 'Ember Ward',
        founder: 'renji',
        officers: ['nozomi', 'nyra'],
        members: ['renji', 'nozomi', 'nyra', 'seiran', 'suiren', 'hayate', 'kohaku', 'alisia', 'reika', 'jiro'],
    },
    {
        name: 'Obsidian Veil',
        founder: 'virath',
        officers: ['roy'],
        members: ['virath', 'roy', 'kaien', 'kairo', 'akari', 'ayame', 'shion', 'daigo', 'isamu', 'lumen'],
    },
].map((clan) => Object.freeze({ ...clan, officers: Object.freeze([...clan.officers]), members: Object.freeze([...clan.members]) })));

import { isNpcClanName, npcClanBareSlug } from './npc-clan-names.js';
export { isNpcClanName, npcClanBareSlug };

/** Mirror of api/_utils.ts safeName (the account-slug rule). */
function accountSlug(name: unknown): string {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
}

/** The NPC clan whose name (any spelling of its record slug) this is. */
export function npcClanByName(name: unknown): NpcClan | undefined {
    const slug = npcClanBareSlug(name);
    return slug ? NPC_CLANS.find((clan) => npcClanBareSlug(clan.name) === slug) : undefined;
}

/**
 * Whether a clan RECORD is Cinderhold's: its name is an NPC clan's and its
 * founder is that clan's NPC founder. A player clan that happened to hold one of
 * these names before the clans were seeded keeps being a player clan.
 */
export function isNpcClanRecord(record: unknown): boolean {
    if (!record || typeof record !== 'object') return false;
    const row = record as { name?: unknown; founderName?: unknown };
    const clan = npcClanByName(row.name);
    return !!clan && accountSlug(row.founderName) === clan.founder;
}

/** The NPC clan an NPC account belongs to. */
export function npcClanOfMember(slug: unknown): NpcClan | undefined {
    const id = accountSlug(slug);
    return id ? NPC_CLANS.find((clan) => clan.members.includes(id)) : undefined;
}
