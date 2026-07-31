/**
 * Admin-authored combat content — the jutsu AND item definitions a sealed fight
 * needs from `save:admin1` / `save:admin2`, as ONE value to pass around.
 *
 * This is a thin COMPOSER, not a third reader. The two catalogs
 * (api/_admin-jutsu-catalog.ts, api/_admin-item-catalog.ts) own the parsing, the
 * merge rules, the 60s memo and the never-throw fallback; this only fetches both
 * and pairs them. Do not re-implement either catalog here — an earlier revision
 * of this file did, and its copy immediately drifted from the real one on how a
 * deletion tombstone behaves.
 *
 * Why pair them at all: the loadout resolvers need both halves at once, and every
 * combat entry point would otherwise thread two nullable maps through the same
 * chain (hydrateCharacterFromSave → sealTowerFighter → the six PvE modes). One
 * `AdminCombatContent` argument keeps those signatures honest.
 *
 * Load it BEFORE taking a save lock: it is I/O, and the resolvers that consume it
 * are synchronous by design.
 *
 * The two halves deliberately merge DIFFERENTLY across the admin slots, each
 * mirroring how the client merges that content type:
 *   • jutsu — by `updatedAt` recency (App.tsx mergeJutsusByRecency)
 *   • items — by slot order, later wins (App.tsx mergeById)
 * See each catalog module for why.
 */
import { loadAdminJutsuObjects, type AdminJutsu } from './_admin-jutsu-catalog.js';
import { loadAdminItemObjects, type AdminItem } from './_admin-item-catalog.js';

export type AdminCombatContent = {
    jutsu: ReadonlyMap<string, AdminJutsu>;
    items: ReadonlyMap<string, AdminItem>;
};

export async function loadAdminCombatContent(): Promise<AdminCombatContent> {
    const [jutsu, items] = await Promise.all([loadAdminJutsuObjects(), loadAdminItemObjects()]);
    return { jutsu, items };
}
