/**
 * Cinderhold's village-war declaration authority (Push 4b, 2026-11-10).
 *
 * Cinderhold has no Kage seat a player could hold, so the world-state declare
 * cannot ask "is this the seated Kage?" for it. Instead the ADMIN-APPROVED
 * proposal (api/_npc-village-war.ts approveNpcWar) runs the real declare
 * in-process as Cinderhold's senior war commander and marks that request
 * object with a module-private Symbol. A Symbol property can never arrive over
 * HTTP (a JSON body or header carries strings only), and the Symbol itself is
 * not exported, so nothing outside this module can forge the mark: an admin
 * playing the NPC over HTTP still meets the seated-Kage gate and is refused.
 */
const NPC_VILLAGE_WAR_AUTHORITY = Symbol('npc-village-war-authority');

/** Marks an in-process request as Cinderhold's admin-approved declaration. */
export function markNpcVillageWarDeclaration<T extends object>(req: T): T {
    Object.defineProperty(req, NPC_VILLAGE_WAR_AUTHORITY, { value: true, enumerable: false });
    return req;
}

/** Whether this request carries the server-only mark (never true for an HTTP request). */
export function hasNpcVillageWarDeclaration(req: unknown): boolean {
    return !!req && typeof req === 'object' && (req as Record<symbol, unknown>)[NPC_VILLAGE_WAR_AUTHORITY] === true;
}

// There is no clan-war counterpart: a Cinderhold clan never declares a clan
// war (owner ruling 2026-11-10), so api/clan/war/declare.ts refuses every NPC
// account outright. Player clans still declare on Cinderhold clans.
