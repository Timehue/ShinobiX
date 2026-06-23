/*
 * Pure derivation + formatting for the right-rail status notification bar.
 *
 * Kept free of any runtime imports (only the erased `Screen` type) so it is
 * trivially unit-testable and carries no bundle weight. The cache-reading
 * orchestration lives in ./notifications (which reads the polled world/clan-war
 * caches and feeds the extracted primitives into buildNotifications here).
 */
import type { Screen } from "../types/core";

export type NotifTone = "danger" | "war" | "event" | "info";

export interface GameNotification {
    /** Stable key for React + de-dupe of unchanged poll results. */
    id: string;
    icon: string;
    label: string;
    tone: NotifTone;
    /** Click target. Omitted ⇒ the chip is informational (not navigable). */
    screen?: Screen;
}

// Screens that are battle-ONLY (no lobby state) — simply being on one means an
// active fight is in progress. weeklyBoss/villageWar are deliberately excluded:
// they get their own dedicated war/event chips below, so listing them here too
// would double up.
const BATTLE_ONLY_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "pvpBattle", "storyBoss", "tilecardsDuel", "dungeon",
    "hollowGateShrine", "hollowGateTiles", "eventTiles", "eventPetBattle",
    "endlessTower",
]);

// Screens that have BOTH a lobby and a fight state. Being on one isn't enough to
// say "in battle" — the orchestrator gates these on a live battle-lock signal.
const LOBBY_FIGHT_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "arena", "battleArena", "arenaDistrict", "petArena",
]);

export function isBattleOnlyScreen(screen: Screen): boolean {
    return BATTLE_ONLY_SCREENS.has(screen);
}

export function isLobbyFightScreen(screen: Screen): boolean {
    return LOBBY_FIGHT_SCREENS.has(screen);
}

export interface NotifInputs {
    /** True when the player is committed to an unresolved fight right now. */
    inBattle: boolean;
    /** Active clan war the player's clan is fighting, or null. */
    clanWar: { enemy: string } | null;
    /** Active village war the player's village is fighting, or null. */
    villageWar: { enemy: string; pending: boolean } | null;
    /** A live arena tournament, or null. */
    tournament: { name: string } | null;
}

/**
 * Build the ordered notification list from already-extracted primitives.
 * Order: most urgent first — your own fight, then wars, then events.
 */
export function buildNotifications(inputs: NotifInputs): GameNotification[] {
    const out: GameNotification[] = [];

    if (inputs.inBattle) {
        // Informational: you're already looking at the fight, and the nav lock
        // blocks leaving it — so no click target.
        out.push({ id: "battle", icon: "⚔️", label: "In battle", tone: "danger" });
    }

    if (inputs.clanWar) {
        out.push({
            id: "clanWar",
            icon: "🏴",
            label: `Clan war vs ${inputs.clanWar.enemy}`,
            tone: "war",
            screen: "clan",
        });
    }

    if (inputs.villageWar) {
        out.push({
            id: "villageWar",
            icon: "🛡️",
            label: `Village war vs ${inputs.villageWar.enemy}${inputs.villageWar.pending ? " (starting)" : ""}`,
            tone: "war",
            screen: "villageWar",
        });
    }

    if (inputs.tournament) {
        out.push({
            id: "tournament",
            icon: "🏆",
            label: inputs.tournament.name ? `Tournament: ${inputs.tournament.name}` : "Tournament live",
            tone: "event",
            screen: "arenaDistrict",
        });
    }

    return out;
}
