/**
 * Which Cinderhold NPC ids are really NPC accounts (2026-11-11).
 *
 * The roster (shared/npc-village-roster.ts) is a static list of account names,
 * so `isNpcAccount(slug)` is true for a name even when a PLAYER registered it
 * before it became an NPC's. Only an auth row the seeder stamped (`npcVillage:
 * true`, no password, no Google or guest login) is an NPC's; anything else is a
 * real person's character and login. The seeder already refuses to write such
 * an account (api/_npc-village-seed.ts). Everything that ACTS as an NPC (the
 * presence tick, the duel and card seats, the war party, campaigns, hunts,
 * admin possession) asks here first, so a player's account is never driven,
 * posted on the map or taken over.
 *
 * One read of the thirty auth rows serves NPC_OWNERSHIP_CACHE_MS; the seeder
 * drops the cache after every pass (a new account is owned at once). A failed
 * read keeps the last answer, or owns nothing (fail closed: an NPC sits a tick
 * out rather than a player being driven).
 */
import { kv } from './_storage.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';

/**
 * Whether an account name is free for, or already owned by, this NPC: no auth
 * row and no save (never used), or an auth row the seeder stamped
 * (`npcVillage: true`). A player's account (a password hash, a Google or guest
 * login, or any unstamped row) or a save with no auth row is never theirs.
 */
export function npcOwnsAccount(auth: Record<string, unknown> | null | undefined, prior: unknown): boolean {
    if (auth) return auth.npcVillage === true && !auth.hash && !auth.salt && !auth.google && !auth.guest;
    return !prior;
}

/** An EXISTING account the seeder created: the runtime test (an account with no auth row yet has nothing to drive). */
export function npcAuthOwned(auth: Record<string, unknown> | null | undefined): boolean {
    return !!auth && npcOwnsAccount(auth, true);
}

export const NPC_OWNERSHIP_CACHE_MS = 60_000;
let cache: { at: number; owned: ReadonlySet<string> } | null = null;

/** The NPC ids whose account the seeder owns right now (cached; never throws). */
export async function npcOwnedIds(now = Date.now()): Promise<ReadonlySet<string>> {
    if (cache && now - cache.at >= 0 && now - cache.at < NPC_OWNERSHIP_CACHE_MS) return cache.owned;
    try {
        const auths = await kv.mget<Array<Record<string, unknown> | null>>(...NPC_VILLAGE_ROSTER.map((npc) => `auth:${npc.id}`));
        const owned = new Set(NPC_VILLAGE_ROSTER.filter((_, i) => npcAuthOwned(auths[i])).map((npc) => npc.id));
        cache = { at: now, owned };
        return owned;
    } catch (error) {
        console.error('[npc-ownership] auth read failed; keeping the last answer', (error as Error)?.message ?? error);
        return cache?.owned ?? new Set<string>();
    }
}

/**
 * Whether any ownership read has ever succeeded. Until one does (a storage
 * error on the first read after boot), npcOwnedIds answers "none", which is
 * safe for every gate but would read as "every NPC is a player's" to the
 * presence tick, so the tick waits instead of dropping all thirty journeys.
 */
export function npcOwnershipKnown(): boolean { return cache !== null; }

/** Whether this NPC id is an NPC's own account (cached). */
export async function npcOwnsSlug(slug: string, now = Date.now()): Promise<boolean> {
    return (await npcOwnedIds(now)).has(slug);
}

/** Whether this NPC id is an NPC's own account, read now (admin actions: never a cached answer). */
export async function npcOwnsSlugFresh(slug: string): Promise<boolean> {
    return npcAuthOwned(await kv.get<Record<string, unknown>>(`auth:${slug}`));
}

/** Drops the cache: the next check reads the auth rows again (after a seed pass, and in tests). */
export function forgetNpcOwnership(): void { cache = null; }
