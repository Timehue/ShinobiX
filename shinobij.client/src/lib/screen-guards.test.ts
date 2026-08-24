import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { BATTLE_SCREENS, RESTORABLE_SCREENS, TRANSIENT_SCREEN_PARENT, isHospitalNavigationBlocked, isUnresolvedBattle, restoreScreenForSave, safeFallbackScreen, screenResetsSector, shouldRedirectToHospital, type BattleGuardSignals } from "./screen-guards";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const navigationGuardSource = readFileSync(new URL("./use-battle-navigation-guard.ts", import.meta.url), "utf8");

function signals(overrides: Partial<BattleGuardSignals>): BattleGuardSignals {
    return {
        screen: "village",
        raidBattleKind: "none",
        pvpBattleId: null,
        pvpBattleResolved: false,
        endlessBattleActive: false,
        pendingArenaStoryBattle: false,
        pendingEventEncounter: false,
        activeDungeonEvent: false,
        hollowGateTileGameActive: false,
        pendingPetBattle: false,
        arenaBattleActive: false,
        petBattleActive: false,
        missionBattleActive: false,
        ...overrides,
    };
}

describe("screen navigation guards", () => {
    it("blocks leaving an unresolved PvP battle", () => {
        assert.equal(isUnresolvedBattle(signals({
            screen: "pvpBattle",
            pvpBattleId: "pvp-live",
        })), true);
    });

    it("allows leaving the PvP result screen after the session resolves", () => {
        assert.equal(isUnresolvedBattle(signals({
            screen: "pvpBattle",
            pvpBattleId: "pvp-done",
            pvpBattleResolved: true,
        })), false);
    });

    it("blocks global navigation during free-play Card Clash duels", () => {
        assert.equal(isUnresolvedBattle(signals({
            screen: "cardClashFreePlay",
        })), true);
    });

    it("blocks lifted arena and pet fight signals without locking their lobbies", () => {
        assert.equal(isUnresolvedBattle(signals({ screen: "arena" })), false);
        assert.equal(isUnresolvedBattle(signals({ screen: "arena", arenaBattleActive: true })), true);
        assert.equal(isUnresolvedBattle(signals({ screen: "petArena" })), false);
        assert.equal(isUnresolvedBattle(signals({ screen: "petArena", petBattleActive: true })), true);
    });

    it("blocks mission navigation only while the server-owned arena fight is unresolved", () => {
        assert.equal(isUnresolvedBattle(signals({ screen: "missions" })), false);
        assert.equal(isUnresolvedBattle(signals({ screen: "missions", missionBattleActive: true })), true);
        assert.equal(isUnresolvedBattle(signals({ screen: "village", missionBattleActive: true })), false);
    });

    it("does not treat passive boss lobby screens as active battles", () => {
        assert.equal(isUnresolvedBattle(signals({
            screen: "weeklyBoss",
        })), false);
    });

    it("blocks navigation only while a server-owned Endless wave is open", () => {
        assert.equal(isUnresolvedBattle(signals({ screen: "endlessTower" })), false);
        assert.equal(isUnresolvedBattle(signals({ screen: "endlessTower", endlessBattleActive: true })), true);
    });

    it("routes active Hollow Gate saves away from stale combat screens", () => {
        assert.equal(restoreScreenForSave("battleTowers", true), "hollowGateShrine");
        assert.equal(restoreScreenForSave("hollowGateTiles", true), "hollowGateShrine");
    });

    it("routes an admitted save to the hospital before any persisted screen", () => {
        assert.equal(restoreScreenForSave("village", false, true), "hospital");
        assert.equal(restoreScreenForSave("hollowGateShrine", true, true), "hospital");
    });

    it("restores an active Dungeon run even when its key was already consumed", () => {
        assert.equal(restoreScreenForSave("village", false, false, true), "dungeon");
        assert.equal(restoreScreenForSave(null, false, false, true), "dungeon");
        assert.equal(restoreScreenForSave("dungeon", false, true, true), "hospital");
    });

    it("redirects settled admissions but never interrupts an unresolved fight", () => {
        assert.equal(shouldRedirectToHospital(true, "missions", false), true);
        assert.equal(shouldRedirectToHospital(true, "hospital", false), false);
        assert.equal(shouldRedirectToHospital(true, "arena", true), false);
        assert.equal(shouldRedirectToHospital(false, "village", false), false);
    });

    it("blocks only a character snapshot that is still admitted", () => {
        assert.equal(isHospitalNavigationBlocked(true, "hospital", "village"), true);
        assert.equal(isHospitalNavigationBlocked(false, "hospital", "village"), false);
        assert.equal(isHospitalNavigationBlocked(true, "hospital", "hospital"), false);
    });

    it("retains normal restorable screens and otherwise uses the village", () => {
        assert.equal(restoreScreenForSave("battleTowers", false), "battleTowers");
        assert.equal(restoreScreenForSave(null, false), "village");
    });

    it("never teleports a wild-sector player to the village on refresh", () => {
        // Where you are is where you are: no restorable screen → back to the world.
        assert.equal(restoreScreenForSave(null, false, false, false, true), "worldMap");
        assert.equal(safeFallbackScreen(true), "worldMap");
        assert.equal(safeFallbackScreen(false), "village");
        // Lobbies / sealed encounters render from the save and are restored as-is.
        for (const s of ["weeklyBoss", "villageWar", "endlessTower", "petArena", "petColiseum", "cardClashFreePlay", "sectorGarrison", "sectorPet", "sectorCard", "clanWarPet", "tilecardsDuel", "storyBoss"] as const) {
            assert.equal(restoreScreenForSave(s, false, false, false, true), s, s);
        }
        // Ephemeral-state screens return to their parent, never the village.
        assert.equal(restoreScreenForSave("userView", false), "userHub");
        assert.equal(restoreScreenForSave("battleLog", false), "arena");
        assert.equal(restoreScreenForSave("eventPetBattle", false, false, false, true), "worldMap");
        assert.equal(restoreScreenForSave("pvpBattle", false, false, false, true), "worldMap");
    });

    it("only entering a town resets the sector — menus do not move the player", () => {
        assert.equal(screenResetsSector("village"), true);
        assert.equal(screenResetsSector("centralHub"), true);
        assert.equal(screenResetsSector("hospital"), true);
        for (const s of ["inventory", "profile", "pets", "messages", "worldMap", "weeklyBoss", "clan", "shop"] as const) {
            assert.equal(screenResetsSector(s), false, s);
        }
        // The App effect must consult the guard rather than its own screen list.
        assert.match(appSource, /if \(screenResetsSector\(screen\)\) setCurrentSector\(0\);/);
        assert.doesNotMatch(appSource, /if \(!inField\) setCurrentSector\(0\)/);
    });

    it("refreshes the App navigation guard when a same-tab Tower lobby becomes a fight", () => {
        assert.match(appSource, /useBattleNavigationGuard\(\{/,
            "App must install the extracted battle-navigation guard");
        const listener = navigationGuardSource.indexOf("window.addEventListener(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard)");
        const cleanup = navigationGuardSource.indexOf("window.removeEventListener(TOWER_FIGHT_STATE_EVENT, syncTowerFightGuard)", listener);
        assert.ok(listener >= 0, "the navigation hook must subscribe to the same-tab Tower fight-state event");
        assert.ok(cleanup > listener, "the navigation hook must remove its Tower fight-state listener");

        const block = navigationGuardSource.slice(Math.max(0, listener - 500), cleanup + 100);
        assert.match(block, /screenRef\.current === "battleTowers"/);
        assert.match(block, /inBattleRef\.current = hasActiveTowerFight\(\)/);
    });
});

describe("a battle screen can never fall back out of its fight", () => {
    // The bug this pins, twice over: a screen that hosts a live fight but is
    // absent from RESTORABLE_SCREENS falls through restoreScreenForSave to
    // safeFallbackScreen — so a refresh mid-fight puts the player in the
    // village while the fight (and, in 2v2, three teammates) carries on
    // without them. It first bit the sector/pet/card family; it bit again when
    // clanWar2v2 arrived from another branch and this allowlist was not
    // updated with it, because nothing failed when the two drifted apart.
    //
    // Only two battle screens are legitimately absent, and both are covered by
    // a run flag that restoreScreenForSave checks BEFORE the allowlist.
    const COVERED_BY_RUN_FLAG = new Set(["hollowGateShrine", "hollowGateTiles", "dungeon"]);
    // `arena` is a lobby after the local-combat retirement, not a fight host.
    const LOBBY_ONLY = new Set(["arena"]);

    it("every battle screen restores to itself, to a parent, or via a run flag", () => {
        const stranded = [...BATTLE_SCREENS].filter(screen =>
            !RESTORABLE_SCREENS.has(screen)
            && !TRANSIENT_SCREEN_PARENT[screen]
            && !COVERED_BY_RUN_FLAG.has(screen)
            && !LOBBY_ONLY.has(screen));
        assert.deepEqual(stranded, [],
            "these battle screens would teleport the player home on refresh — "
            + "add each to RESTORABLE_SCREENS (the fight rehydrates from the server) "
            + "or to TRANSIENT_SCREEN_PARENT (it cannot, so return to where it was opened from)");
    });

    it("the run-flag escape hatch really is checked first", () => {
        // If this ever stops being true, the exemption above becomes a hole.
        assert.equal(restoreScreenForSave("hollowGateShrine", true, false, false, false), "hollowGateShrine");
        assert.equal(restoreScreenForSave("hollowGateTiles", true, false, false, false), "hollowGateShrine");
        assert.equal(restoreScreenForSave("dungeon", false, false, true, false), "dungeon");
    });

    it("clanWar2v2 survives a refresh instead of landing in the village", () => {
        assert.equal(restoreScreenForSave("clanWar2v2", false, false, false, false), "clanWar2v2");
        assert.equal(restoreScreenForSave("clanWar2v2", false, false, false, true), "clanWar2v2");
    });
});
