import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isHospitalNavigationBlocked, isUnresolvedBattle, restoreScreenForSave, shouldRedirectToHospital, type BattleGuardSignals } from "./screen-guards";

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
