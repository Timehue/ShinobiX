import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isUnresolvedBattle, restoreScreenForSave, shouldRedirectToHospital, type BattleGuardSignals } from "./screen-guards";

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

    it("redirects settled admissions but never interrupts an unresolved fight", () => {
        assert.equal(shouldRedirectToHospital(true, "missions", false), true);
        assert.equal(shouldRedirectToHospital(true, "hospital", false), false);
        assert.equal(shouldRedirectToHospital(true, "arena", true), false);
        assert.equal(shouldRedirectToHospital(false, "village", false), false);
    });

    it("retains normal restorable screens and otherwise uses the village", () => {
        assert.equal(restoreScreenForSave("battleTowers", false), "battleTowers");
        assert.equal(restoreScreenForSave(null, false), "village");
    });
});
