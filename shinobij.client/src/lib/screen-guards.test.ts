import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isUnresolvedBattle, type BattleGuardSignals } from "./screen-guards";

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
});
