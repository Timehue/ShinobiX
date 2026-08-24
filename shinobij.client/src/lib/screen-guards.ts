// Single source of truth for screen-navigation guards:
//   1. which screens can be restored as-is after a page refresh, and
//   2. which screens represent an in-progress fight you must not walk out of.
//
// Kept out of App.tsx (which is at its line-budget ceiling) so the routing and
// the navigation lock share one definition instead of drifting apart.

import type { Screen } from "../types/core";
import { BATTLE_LOCK_ID_KEY } from "./battle-save";
import { isWildSector } from "../../../shared/sector-geo";

export { isWildSector };

// ─── Refresh-restore routing ────────────────────────────────────────────────
//
// Hub/lobby screens that render correctly from the LOADED SAVE ALONE after a
// refresh — safe to deep-link to (URL hash) and to restore from lastScreen.v1.
// Anything NOT here is transient or session-bound; on reload its dedicated
// recovery path restores a sealed server session or routes to a safe parent.
export const DEEP_LINKABLE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "village", "profile", "inventory", "logbook", "training",
    "jutsuTraining", "missions", "bloodlineMaker", "clan", "worldMap", "townHall",
    "bank", "shop", "grandMarketplace", "hospital", "cafeteria", "storyHall",
    "centralHub", "home", "pets", "petLadder", "hunting", "tavern", "hallOfLegends", "shinobiCouncil",
    "messages", "professions", "villageWarMap",
    // Added: safe, save-only hub screens that previously fell through to the
    // village on refresh (the reported "refresh dumps me to the village" bug).
    "guides", "shinobiTiles", "sunscarFestival",
]);

// Screens we restore on refresh: the deep-linkable hubs plus the Arena
// lobby/district family, which is presentation-only after the local combat
// retirement. Live fights recover through their sealed session hosts, never by
// restoring combat state into these lobbies.
export const RESTORABLE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    ...DEEP_LINKABLE_SCREENS,
    "arena", "battleArena", "arenaDistrict", "userHub",
    // Battle Towers resumes from the SERVER session on refresh: the run lives in
    // tower:<runId> and the screen re-fetches it by id (see hasActiveTowerFight +
    // BattleTowers' resume effect). So it's safe to restore the screen — the fight
    // is rehydrated from the server, not reconstructed from lost React state.
    // (NOT in DEEP_LINKABLE_SCREENS — an in-fight URL shouldn't be shareable.)
    "battleTowers",
    // Pet Showdown follows the Battle Towers precedent: the fight lives in a
    // SERVER session (pet:showdown:<player>:<id>, 45-min TTL) and the screen
    // re-fetches it by id on mount, so restoring the screen re-enters the live
    // fight instead of reconstructing lost React state. Without this entry the
    // allowlist rejection is what dumped a mid-fight reload in the village.
    "petShowdown",
    // Lobbies and server-sealed encounters that render from the save alone (or
    // from a sessionStorage stash that survives a reload and is handled when
    // missing). Before these were listed, a refresh on any of them fell through
    // to the village — i.e. teleported the player home out of the world.
    "weeklyBoss", "villageWar", "endlessTower", "petArena", "petColiseum",
    "cardClashFreePlay", "clanWarPet", "tilecardsDuel",
    "sectorCard", "sectorPet", "sectorGarrison", "storyBoss",
]);

// Screens that only exist around ephemeral React state (a viewed profile, a
// battle-log id, a pending encounter). On a refresh they cannot render, so we
// return to the screen they were opened FROM — never to the village, which
// would move the player out of the world.
export const TRANSIENT_SCREEN_PARENT: Readonly<Partial<Record<Screen, Screen>>> = {
    pvpBattle: "worldMap",
    eventPetBattle: "worldMap",
    eventTiles: "worldMap",
    userView: "userHub",
    battleLog: "arena",
};

// ─── Location ──────────────────────────────────────────────────────────────
//
// Your SECTOR is where you are in the world; the SCREEN is just the panel you
// are looking at. Opening the inventory / profile / pets / messages from a wild
// sector must not move you — you stay present (and attackable) where you
// stand. Only walking into a town resets the sector to 0: the village and
// Central hubs (entered explicitly from the map or the "← Village" button) and
// the hospital (you were carried there).
export const TOWN_SCREENS: ReadonlySet<Screen> = new Set<Screen>(["village", "centralHub", "hospital"]);

export function screenResetsSector(screen: Screen): boolean {
    return TOWN_SCREENS.has(screen);
}

/** Where a player lands when no screen can be restored: the world if they are in it, else town. */
export function safeFallbackScreen(inWildSector: boolean): Screen {
    return inWildSector ? "worldMap" : "village";
}

// An active Hollow Gate run is the strongest restore signal. Older builds sent
// Gate encounters through Battle Towers, so that breadcrumb must not strand an
// upgraded player in the retired combat mode.
export function restoreScreenForSave(
    persisted: Screen | null,
    inHollowGateRun: boolean,
    hospitalized = false,
    inDungeonRun = false,
    inWildSector = false,
): Screen {
    // Hospital admission is stronger than a bookmarked/last-visited hub and
    // than a stale dungeon breadcrumb. Admitted HP intentionally does not
    // regenerate, so restoring anywhere else strands the player at zero HP.
    if (hospitalized) return "hospital";
    if (inHollowGateRun) return "hollowGateShrine";
    if (inDungeonRun) return "dungeon";
    if (persisted && RESTORABLE_SCREENS.has(persisted)) return persisted;
    const parent = persisted ? TRANSIENT_SCREEN_PARENT[persisted] : undefined;
    if (parent) return parent;
    return safeFallbackScreen(inWildSector);
}

/**
 * Keep a newly-settled or remotely-loaded admission on the Hospital screen.
 * An unresolved battle wins precedence until its terminal state has landed;
 * the next render then redirects without every PvE host duplicating routing.
 */
export function shouldRedirectToHospital(
    hospitalized: boolean,
    screen: Screen,
    unresolvedBattle: boolean,
): boolean {
    return hospitalized && screen !== "hospital" && !unresolvedBattle;
}

export function isHospitalNavigationBlocked(hospitalized: boolean, screen: Screen, nextScreen: Screen): boolean {
    return hospitalized && screen === "hospital" && nextScreen !== "hospital";
}

// ─── Battle screens (navigation lock) ───────────────────────────────────────
//
// Screens that are battle-only, session hosts, or retained compatibility
// routing surfaces. `arena` is now lobby-only; `petArena` still has both lobby
// and fight states, so the runtime guard gates mixed screens on explicit state.
// Used by App-level battle-flow effects as the broad catalog, while
// isUnresolvedBattle() below decides whether a mixed lobby/fight screen is
// actively locked.
export const BATTLE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "pvpBattle", "petArena", "petShowdown", "arena", "storyBoss", "weeklyBoss", "villageWar",
    "hollowGateShrine", "hollowGateTiles", "endlessTower", "dungeon", "eventTiles",
    "eventPetBattle", "tilecardsDuel", "sectorCard", "cardClashFreePlay", "battleTowers",
]);

// Battle Towers has no server BattleLockKeeper — the run lives in tower:<runId>
// and a refresh RESUMES it (the screen is restorable and re-fetches the session
// by id). The combined BattleTowers screen stores the active runId under this key
// while a fight is on the board, so its presence doubles as the "in a fight"
// signal the nav lock reads here; the lobby state leaves it unset. The event is
// same-tab reactivity for App's ref-backed guard (`storage` only fires in other
// documents), and is dispatched synchronously after every Tower-owned write.
export const TOWER_RUN_KEY = "shinobix:towerRunId";
export const TOWER_FIGHT_STATE_EVENT = "shinobix:tower-fight-state";
export const TOWER_PVP_RUN_PREFIX = "pvp:";

export function setTowerFightRunId(runId: string | null): void {
    try {
        if (runId) localStorage.setItem(TOWER_RUN_KEY, runId);
        else localStorage.removeItem(TOWER_RUN_KEY);
    } catch { /* storage disabled */ }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(TOWER_FIGHT_STATE_EVENT));
}

export function setTowerPvpMatchId(matchId: string | null): void {
    setTowerFightRunId(matchId ? `${TOWER_PVP_RUN_PREFIX}${matchId}` : null);
}

export function towerPvpMatchIdFromRunKey(value: string | null | undefined): string | null {
    if (!value?.startsWith(TOWER_PVP_RUN_PREFIX)) return null;
    const matchId = value.slice(TOWER_PVP_RUN_PREFIX.length);
    return /^tpvp-[a-f0-9]{32}$/i.test(matchId) ? matchId : null;
}
export function hasActiveTowerFight(): boolean {
    try {
        return !!localStorage.getItem(TOWER_RUN_KEY);
    } catch {
        return false;
    }
}

// True when a remaining non-session screen has mirrored an unresolved fight to
// the compatibility lock. Sealed combat hosts use their own session ids, and
// boot removes unsupported pre-cutover Arena markers instead of resuming them.
export function hasActiveBattleLock(): boolean {
    try {
        return !!localStorage.getItem(BATTLE_LOCK_ID_KEY);
    } catch {
        return false;
    }
}

// Runtime signals (all App-level state) the navigation lock reads to decide
// whether the player is currently committed to an unresolved fight. Kept as a
// plain bag so navigate()/goBack() pass a snapshot and the decision lives here.
export interface BattleGuardSignals {
    screen: Screen;
    raidBattleKind: string;            // "none" | "raidAi" | "raidPlayer" | "defense"
    pvpBattleId: string | null;        // tactical PvP server session
    pvpBattleResolved?: boolean;       // result screen is showing; safe to leave
    endlessBattleActive: boolean;      // server-owned Endless fight over its lobby
    pendingArenaStoryBattle: boolean;  // pre-cutover routing breadcrumb; boot retires it
    pendingEventEncounter: boolean;    // event card / pet battle
    activeDungeonEvent: boolean;       // dungeon run in progress
    hollowGateTileGameActive: boolean; // hollow-gate tile seal
    pendingPetBattle: boolean;         // pet PvP just accepted (partial — see note)
    arenaBattleActive: boolean;        // retired compatibility slot; App supplies false
    petBattleActive: boolean;          // lifted from PetArena: pet sim in progress
    missionBattleActive: boolean;      // lifted from Missions: server-owned MissionArenaFight
}

// True when the player must NOT be allowed to navigate away (they can only
// Forfeit, which applies the loss). Battle screens mostly drive their OWN exits
// via raw setScreen, so this primarily blocks the global nav/travel bar.
// Screen-gated so a stale lock can never trap a player on a hub screen, and so
// the arena/pet lobbies (no fight in flight) stay freely navigable.
export function isUnresolvedBattle(s: BattleGuardSignals): boolean {
    if (s.raidBattleKind !== "none") return true; // mission raid / human raid / defense
    switch (s.screen) {
        case "missions":
            return s.missionBattleActive;
        case "arena":
        case "battleArena":
        case "arenaDistrict":
            // These screens are lobbies after the local Arena retirement. The
            // false compatibility flag and legacy signals remain only to fence
            // rolling-upgrade breadcrumbs while boot routes sealed sessions.
            return s.arenaBattleActive || hasActiveBattleLock()
                || s.endlessBattleActive || s.pendingArenaStoryBattle;
        case "pvpBattle":
            return !!s.pvpBattleId && !s.pvpBattleResolved;
        case "petArena":
            return s.petBattleActive || s.pendingPetBattle;
        case "petShowdown":
            // Showdown lifts the same signal PetArena does: true only while a
            // server session is unresolved (the lobby stays freely navigable).
            return s.petBattleActive;
        case "endlessTower":
            return s.endlessBattleActive;
        case "storyBoss":          // battle-only screen, no lobby
        case "tilecardsDuel":      // clan-war card duel, battle-only
        case "sectorCard":         // sector-war card battle, battle-only
        case "cardClashFreePlay":  // free-play PvP card duel, battle-only
        case "hollowGateShrine":   // dungeon MAP: no retreat — exit only via the
                                   // in-map Leave tile or death (both setScreen
                                   // directly, bypassing the nav lock). Without
                                   // this, players walked out → hospital → healed
                                   // → resumed the run free, voiding the no-heal rule.
            return true;
        case "eventTiles":
        case "eventPetBattle":
            return s.pendingEventEncounter;
        case "hollowGateTiles":
            return s.hollowGateTileGameActive;
        case "dungeon":
            return s.activeDungeonEvent;
        case "battleTowers":       // squad tower: lobby is free, an on-board fight isn't
            return hasActiveTowerFight();
        default:
            return false;
    }
}
