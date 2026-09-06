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
    /** Optional destination within a multi-tab screen. */
    targetView?: "territory";
}

// Screens that are battle-ONLY (no lobby state) — simply being on one means an
// active fight is in progress. weeklyBoss/villageWar are deliberately excluded:
// they get their own dedicated war/event chips below, so listing them here too
// would double up.
const BATTLE_ONLY_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "pvpBattle", "storyBoss", "tilecardsDuel", "sectorCard", "cardClashFreePlay", "dungeon",
    "hollowGateShrine", "hollowGateTiles", "eventTiles", "eventPetBattle",
    "endlessTower",
]);

// Screens that have BOTH a lobby and a fight state. Being on one isn't enough to
// say "in battle" — the orchestrator gates these on a live battle-lock signal.
const LOBBY_FIGHT_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "arena", "battleArena", "arenaDistrict", "petArena", "petShowdown",
]);

export function isBattleOnlyScreen(screen: Screen): boolean {
    return BATTLE_ONLY_SCREENS.has(screen);
}

export function isLobbyFightScreen(screen: Screen): boolean {
    return LOBBY_FIGHT_SCREENS.has(screen);
}

// Screens that render the actual fight board. Being on one means the player is
// already looking at the battle, so the "In battle" chip is redundant there — it
// should only surface as a reminder when a fight is in progress but the player is
// on a different screen (e.g. an arena / pet-arena lobby with a live battle-lock).
const BATTLE_VIEW_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    ...BATTLE_ONLY_SCREENS, "arena", "battleArena", "battleTowers",
]);

export function isBattleViewScreen(screen: Screen): boolean {
    return BATTLE_VIEW_SCREENS.has(screen);
}

export interface BattleChromeInputs {
    screen: Screen;
    /** Arena District and Pet Arena have lobby + fight states; hide only mid-fight. */
    arenaBattleActive: boolean;
    petBattleActive: boolean;
}

export function shouldHideBattleChrome(inputs: BattleChromeInputs): boolean {
    const isArenaLobby = inputs.screen === "arena" || inputs.screen === "battleArena" || inputs.screen === "arenaDistrict";
    return (isBattleViewScreen(inputs.screen) && inputs.screen !== "arena" && inputs.screen !== "battleArena")
        || (isArenaLobby && inputs.arenaBattleActive)
        || (inputs.screen === "petArena" && inputs.petBattleActive)
        // Pet Showdown is a mixed lobby/fight screen like petArena; its battle
        // overlay lifts the same fullscreen/battle signals.
        || (inputs.screen === "petShowdown" && inputs.petBattleActive)
        // The First Pact is a fixed full-viewport city surface from its very
        // first frame (its level gate included), with its own HUD and exit —
        // the side rails would only float above it and clip its panels.
        || inputs.screen === "firstPact";
}

export interface NotifInputs {
    /** True when the player is committed to an unresolved fight right now. */
    inBattle: boolean;
    /** Active clan war the player's clan is fighting, or null. */
    clanWar: { enemy: string } | null;
    /** Most urgent breached sector owned by the player's clan. */
    territoryBreach: { sector: number; minutesLeft: number } | null;
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

    if (inputs.territoryBreach) {
        const minutes = Math.max(1, Math.ceil(inputs.territoryBreach.minutesLeft));
        const timeLeft = minutes >= 60
            ? `${Math.ceil(minutes / 60)}h left`
            : `${minutes}m left`;
        out.push({
            id: "territoryBreach",
            icon: "🚨",
            label: `Sector ${inputs.territoryBreach.sector} breached · ${timeLeft}`,
            tone: "danger",
            screen: "clan",
            targetView: "territory",
        });
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
