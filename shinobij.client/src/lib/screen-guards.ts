// Single source of truth for screen-navigation guards:
//   1. which screens can be restored as-is after a page refresh, and
//   2. which screens represent an in-progress fight you must not walk out of.
//
// Kept out of App.tsx (which is at its line-budget ceiling) so the routing and
// the navigation lock share one definition instead of drifting apart.

import type { Screen } from "../types/core";
import { BATTLE_LOCK_ID_KEY } from "./battle-save";

// ─── Refresh-restore routing ────────────────────────────────────────────────
//
// Hub/lobby screens that render correctly from the LOADED SAVE ALONE after a
// refresh — safe to deep-link to (URL hash) and to restore from lastScreen.v1.
// Anything NOT here is a transient / mid-encounter screen whose state lives only
// in React; on reload it force-re-enters (battles) or routes to a safe parent.
export const DEEP_LINKABLE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "village", "villageLore", "profile", "inventory", "logbook", "training",
    "jutsuTraining", "missions", "bloodlineMaker", "clan", "worldMap", "townHall",
    "bank", "shop", "grandMarketplace", "hospital", "cafeteria", "storyHall",
    "centralHub", "pets", "hunting", "tavern", "hallOfLegends", "shinobiCouncil",
    "messages",
    // Added: safe, save-only hub screens that previously fell through to the
    // village on refresh (the reported "refresh dumps me to the village" bug).
    "guides", "shinobiTiles", "sunscarFestival",
]);

// Screens we restore on refresh: the deep-linkable hubs plus the arena
// lobby/district family, which render fine with no fight in flight (an
// in-progress PvE arena fight additionally resumes via ArenaBattlePersister).
export const RESTORABLE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    ...DEEP_LINKABLE_SCREENS,
    "arena", "battleArena", "arenaDistrict", "userHub",
]);

// ─── Battle screens (navigation lock) ───────────────────────────────────────
//
// Screens that represent an in-progress fight. `arena` and `petArena` ALSO have
// non-fight lobby states, so the runtime guard (isUnresolvedBattle) gates those
// on an active-fight signal rather than on the screen alone.
// NOTE: this set is currently unreferenced — the live no-retreat gate is
// isUnresolvedBattle() below. Kept as documentation; now also lists the active
// HollowGate shrine screen (hollowGateShrine) alongside the legacy tile seal so
// it stays accurate if anything wires it up later.
export const BATTLE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
    "pvpBattle", "petArena", "arena", "storyBoss", "weeklyBoss", "villageWar",
    "hollowGateShrine", "hollowGateTiles", "endlessTower", "dungeon", "eventTiles",
    "eventPetBattle", "tilecardsDuel", "battleTowers",
]);

// Battle Towers has no server BattleLockKeeper (the run lives in tower:<runId>
// and a refresh just drops back to Central with no penalty). The combined
// BattleTowers screen sets this flag while a fight is on the board so the nav
// lock blocks leaving mid-fight; the lobby state leaves it unset.
const TOWER_FIGHT_FLAG = "shinobix:towerFightActive";
export function hasActiveTowerFight(): boolean {
    try {
        return !!localStorage.getItem(TOWER_FIGHT_FLAG);
    } catch {
        return false;
    }
}

// True when an unresolved PvE/story fight is registered on the server lock
// (BattleLockKeeper sets this only while a fight is actually in progress, and
// clears it the instant the fight ends — so it cleanly distinguishes the arena
// lobby from an arena fight).
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
    endlessBattleActive: boolean;      // endless tower fight (in arena)
    pendingArenaStoryBattle: boolean;  // story / weekly / boss / event fight (in arena)
    pendingEventEncounter: boolean;    // event card / pet battle
    activeDungeonEvent: boolean;       // dungeon run in progress
    hollowGateTileGameActive: boolean; // hollow-gate tile seal
    pendingPetBattle: boolean;         // pet PvP just accepted (partial — see note)
    arenaBattleActive: boolean;        // lifted from Arena: any arena fight incl. ranked
    petBattleActive: boolean;          // lifted from PetArena: pet sim in progress
}

// True when the player must NOT be allowed to navigate away (they can only
// Forfeit, which applies the loss). Battle screens mostly drive their OWN exits
// via raw setScreen, so this primarily blocks the global nav/travel bar.
// Screen-gated so a stale lock can never trap a player on a hub screen, and so
// the arena/pet lobbies (no fight in flight) stay freely navigable.
export function isUnresolvedBattle(s: BattleGuardSignals): boolean {
    if (s.raidBattleKind !== "none") return true; // mission raid / human raid / defense
    switch (s.screen) {
        case "arena":
        case "battleArena":
        case "arenaDistrict":
            // Lifted flag covers every arena fight (AI/ranked/endless/story/human);
            // the lock + endless/story flags are belt-and-suspenders.
            return s.arenaBattleActive || hasActiveBattleLock()
                || s.endlessBattleActive || s.pendingArenaStoryBattle;
        case "pvpBattle":
            return !!s.pvpBattleId;
        case "petArena":
            return s.petBattleActive || s.pendingPetBattle;
        case "storyBoss":          // battle-only screen, no lobby
        case "tilecardsDuel":      // clan-war card duel, battle-only
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
