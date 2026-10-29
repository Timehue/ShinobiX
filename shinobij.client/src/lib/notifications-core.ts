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
    /** Optional destination within a multi-tab screen ("reckoning" = World Crisis Level 80). */
    targetView?: "territory" | "reckoning";
    /** Tooltip; defaults to "Go to <label>" for navigable chips. */
    title?: string;
}

// Screens that are battle-ONLY (no lobby state) — simply being on one means an
// active fight is in progress. weeklyBoss/villageWar are deliberately excluded:
// they get their own dedicated war/event chips below, so listing them here too
// would double up.
// The three Sector War tables are fights like any other: the Card table always
// was, and the Pet duel and the Combat garrison assault now are too, so none of
// them shows side rails over its board (owner ruling 2026-10-08).
const BATTLE_ONLY_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "pvpBattle", "storyBoss", "tilecardsDuel", "sectorCard", "sectorPet", "sectorGarrison",
    "cardClashFreePlay", "dungeon",
    "hollowGateShrine", "hollowGateTiles", "eventTiles", "eventPetBattle",
    "endlessTower",
]);

// Screens that have BOTH a lobby and a fight state. Being on one isn't enough to
// say "in battle"; their fights hide the side rails through shouldHideBattleChrome.
const LOBBY_FIGHT_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "arena", "battleArena", "arenaDistrict", "petArena", "petShowdown", "petLadder",
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
// on a different screen (see liveFightScreen below).
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
        || ((inputs.screen === "petArena" || inputs.screen === "petLadder") && inputs.petBattleActive)
        // Pet Showdown is a mixed lobby/fight screen like petArena; its battle
        // overlay lifts the same fullscreen/battle signals.
        || (inputs.screen === "petShowdown" && inputs.petBattleActive)
        // The First Pact is a fixed full-viewport city surface from its very
        // first frame (its level gate included), with its own HUD and exit —
        // the side rails would only float above it and clip its panels.
        || inputs.screen === "firstPact";
}

/** The save fields that hold a run a player can be pulled away from. */
export interface SavedRunFields {
    hollowGateRun?: { completed: boolean } | null;
    activeDungeonRun?: { token: string } | null;
}

/** Screen that resumes the player's saved Hollow Gate or dungeon run, or null. */
export function savedRunScreen(save: SavedRunFields | null | undefined): Screen | null {
    if (save?.hollowGateRun && !save.hollowGateRun.completed) return "hollowGateShrine";
    if (save?.activeDungeonRun?.token) return "dungeon";
    return null;
}

// Screens that host a Tower-session fight themselves. The run key alone cannot
// say which of them owns it, so none of them points the player elsewhere.
const TOWER_HOST_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "battleTowers", "worldCrisis", "arenaDistrict", "battleArena",
]);

/**
 * Where the player's live fight is when they are NOT looking at it, or null.
 *
 * Only state that outlives leaving the fight counts: a saved Hollow Gate or
 * dungeon run, and the Battle Towers run key. Fights held in a screen's own
 * React state end when that screen unmounts, and the legacy battle-lock marker
 * can outlive a finished fight, so neither of those is read here.
 */
export function liveFightScreen(screen: Screen, savedRun: Screen | null, towerRunKey: string | null): Screen | null {
    // An admitted player cannot leave the Hospital, so the chip could not act there.
    if (isBattleViewScreen(screen) || screen === "hospital") return null;
    if (savedRun) return savedRun === screen ? null : savedRun;
    if (!towerRunKey || TOWER_HOST_SCREENS.has(screen)) return null;
    // A "pvp:" match seen from another screen is a Team Arena 2v2: ranked and
    // tournament matches lock Arena District until they end, but the Battle
    // Arena can be left mid-match. It opens its Team Arena tab for this key and
    // re-enters the match from server presence, which also clears a stale key.
    if (towerRunKey.startsWith("pvp:")) return "battleArena";
    // World Crisis stores its tower runs ("wcr80-<hex>") and pet fronts
    // ("wcr80pet:<session>") under the same key as Battle Towers.
    return towerRunKey.startsWith("wcr80") ? "worldCrisis" : "battleTowers";
}

export interface NotifInputs {
    /** Screen hosting a live fight the player has stepped away from, or null. */
    battle: Screen | null;
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

    if (inputs.battle) {
        out.push({
            id: "battle", icon: "⚔️", label: "In battle", tone: "danger", screen: inputs.battle, title: "Return to your battle",
            // World Crisis opens on its Level 37 chronicle; the Level 80 tab is
            // the one that resumes a Reckoning fight.
            ...(inputs.battle === "worldCrisis" ? { targetView: "reckoning" as const } : {}),
        });
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
