/*
 * Right-rail status notifications — reads the already-polled shared caches and
 * the current screen, then formats them into the chip list rendered by
 * components/NotificationBar.
 *
 * No new network polling: it reuses the caches App already refreshes —
 *   • clan wars   ← sharedClanWarCache (refreshed every 30s)
 *   • village wars ← world-state cache (refreshed every 15s)
 *   • tournament  ← arena-tournament cache (refreshed every 5s via game-state)
 * plus the saved Hollow Gate / dungeon run and the Tower run key. The component re-derives on a short
 * interval, so a chip appears/clears within a few seconds of the cache moving.
 */
import type { Screen } from "../types/core";
import { sharedClanWarCache } from "./clan-war-read-api";
import {
    activeVillageWarsFor,
    loadAllSectorTerritories,
    loadArenaTournament,
    territoryBreachMinsLeft,
} from "./world-state";
import { towerFightRunKey } from "./screen-guards";
import {
    buildNotifications,
    liveFightScreen,
    type GameNotification,
} from "./notifications-core";

export type { GameNotification } from "./notifications-core";

export interface NotifContext {
    screen: Screen;
    clan?: string;
    village?: string;
    /** savedRunScreen() of the player's save: a Hollow Gate or dungeon run. */
    savedRun?: Screen | null;
    /** Injectable for tests; defaults to Date.now(). */
    now?: number;
}

export function computeNotifications(ctx: NotifContext): GameNotification[] {
    const now = ctx.now ?? Date.now();

    // Clan war — your clan is in an un-ended war.
    let clanWar: { enemy: string } | null = null;
    const clan = ctx.clan?.trim().toLowerCase();
    if (clan) {
        const war = Object.values(sharedClanWarCache).find(
            (w) => !w.endedAt && w.clans.some((c) => c.toLowerCase() === clan),
        );
        if (war) {
            clanWar = { enemy: war.clans.find((c) => c.toLowerCase() !== clan) ?? "Rival clan" };
        }
    }

    const territoryBreach = clan
        ? loadAllSectorTerritories()
            .filter((territory) => territory.ownerClan?.trim().toLowerCase() === clan)
            .map((territory) => ({
                sector: territory.sector,
                minutesLeft: territoryBreachMinsLeft(territory, now),
            }))
            .filter((territory) => territory.minutesLeft > 0)
            .sort((a, b) => a.minutesLeft - b.minutesLeft)[0] ?? null
        : null;

    // Village war — your village is in an un-ended war.
    let villageWar: { enemy: string; pending: boolean } | null = null;
    const village = ctx.village?.trim();
    if (village) {
        const vwar = activeVillageWarsFor(village)[0];
        if (vwar) {
            villageWar = {
                enemy: vwar.villages.find((v) => v !== village) ?? "Rival village",
                pending: Boolean(vwar.pendingUntil && vwar.pendingUntil > now),
            };
        }
    }

    // Tournament — a live (or imminent) arena tournament.
    let tournament: { name: string } | null = null;
    const t = loadArenaTournament();
    if (t && t.endsAt > now) {
        tournament = { name: t.name ?? "" };
    }

    return buildNotifications({
        // Only a reminder when you've stepped AWAY from a live fight — on the
        // battle board itself the chip is redundant (you're looking at it) and
        // just overlaps the field on mobile. Clicking it takes you back.
        battle: liveFightScreen(ctx.screen, ctx.savedRun ?? null, towerFightRunKey()),
        territoryBreach,
        clanWar,
        villageWar,
        tournament,
    });
}
