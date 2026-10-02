/*
 * Slim player saves: stop storing copies of SHARED admin content in every
 * ordinary player's `save:<name>` row.
 *
 * Measured 2026-10-01 on production: the character itself averaged ~10 KB of a
 * ~280 KB median save; most of the rest was copies of admin-authored content
 * (the pet catalog alone 139 KB, only 29 distinct versions across 168 saves).
 * Those copies inflate every autosave, the owner GET, the nightly snapshots, the
 * roster read and the compare-and-set commit.
 *
 * Removed: editablePets / creatorAis / creatorEvents / creatorCards. No server
 * code reads a PLAYER's copy of these — combat, rewards and shops read the admin
 * slots (api/_admin-*-catalog.ts); the client pulls them at login (App.tsx
 * pullSharedAdminContent) and caches them on the device.
 *
 * Deliberately NOT touched:
 *   - creatorItems (~58 KB a save, almost all copies of admin items). Combat
 *     falls back to a player's copy when the admin catalog no longer defines an
 *     id, and the Admin Panel deletes custom items without a tombstone — so a
 *     copy can be the last definition of gear the player holds, including gear
 *     held OUTSIDE the save row (an Exchange listing in escrow, a pending grant).
 *     Keeping every item copy makes item resolution unchanged by construction.
 *   - creatorJutsus: PvP still resolves a player's stored copy over the admin
 *     one (api/pvp/session.ts), and the owner chose zero PvP change (2026-10-01).
 *
 * ON by default (owner, 2026-10-01: ship features on with a kill switch, never a
 * Railway rollout step). SLIM_PLAYER_SAVES=0 switches it off instantly; saves
 * already slimmed keep working because the content they dropped lives in the
 * admin slots. A save's first slim is additionally proven with the real fight
 * loaders before it commits (firstSlimKeepsEveryFight, ./_slim-parity.ts).
 */

/** Top-level shared-content copies that are removed outright. */
export const SLIMMED_SHARED_FIELDS = ['editablePets', 'creatorAis', 'creatorEvents', 'creatorCards'] as const;

/** On unless explicitly switched off with SLIM_PLAYER_SAVES=0 (the kill switch). */
export function slimPlayerSavesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.SLIM_PLAYER_SAVES?.trim() !== '0';
}

export type SlimResult<T> = { record: T; changed: boolean; removedFields: string[] };

/**
 * Remove shared-content copies from an ordinary player's save record. Pure:
 * returns a new object and never mutates `record` (callers commit with
 * compare-and-set against it). Returns `record` itself when nothing changed.
 */
export function slimPlayerSaveRecord<T extends Record<string, unknown>>(record: T): SlimResult<T> {
    const next: Record<string, unknown> = { ...record };
    const removedFields: string[] = [];
    for (const field of SLIMMED_SHARED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
            delete next[field];
            removedFields.push(field);
        }
    }
    const changed = removedFields.length > 0;
    return { record: (changed ? next : record) as T, changed, removedFields };
}
