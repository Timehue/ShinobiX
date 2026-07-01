/*
 * Right-rail status notifications — reads the already-polled shared caches and
 * the current screen, then formats them into the chip list rendered by
 * components/NotificationBar.
 *
 * No new network polling: it reuses the caches App already refreshes —
 *   • clan wars   ← sharedClanWarCache (refreshed every 30s)
 *   • village wars ← world-state cache (refreshed every 15s)
 *   • tournament  ← arena-tournament cache (refreshed every 5s via game-state)
 * plus the localStorage battle-lock flags. The component re-derives on a short
 * interval, so a chip appears/clears within a few seconds of the cache moving.
 */
import type { Screen } from "../types/core";
import { sharedClanWarCache } from "./clan-war-api";
import { activeVillageWarsFor, loadArenaTournament } from "./world-state";
import { hasActiveBattleLock, hasActiveTowerFight } from "./screen-guards";
import {
    buildNotifications,
    isBattleOnlyScreen,
    isBattleViewScreen,
    isLobbyFightScreen,
    type GameNotification,
} from "./notifications-core";

export type { GameNotification } from "./notifications-core";

/** True when the player is committed to an unresolved fight right now. */
export function isInBattle(screen: Screen): boolean {
    if (isBattleOnlyScreen(screen)) return true;
    // Battle Towers resumes from the server session; the run id in localStorage
    // doubles as the "fight on the board" signal (see lib/screen-guards).
    if (screen === "battleTowers") return hasActiveTowerFight();
    // Arena / pet-arena lobbies are freely navigable; only an active server
    // battle-lock means a fight is actually in progress.
    if (isLobbyFightScreen(screen)) return hasActiveBattleLock();
    return false;
}

export interface NotifContext {
    screen: Screen;
    clan?: string;
    village?: string;
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
        // just overlaps the field on mobile.
        inBattle: isInBattle(ctx.screen) && !isBattleViewScreen(ctx.screen),
        clanWar,
        villageWar,
        tournament,
    });
}
