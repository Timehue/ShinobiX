import assert from "node:assert/strict";
import test from "node:test";
import { battleEntryWarmupDelay } from "./battle-entry-warmup";

const ready = { screen: "worldMap" as const, hasCharacter: true, restoringSession: false, onboardingStep: "done" as const, saveData: false };

test("noncombat screens, restore and Academy do not speculatively download PvP", () => {
    for (const screen of ["start", "village", "inventory", "profile", "adminPanel"] as const) {
        assert.equal(battleEntryWarmupDelay({ ...ready, screen }), null);
    }
    assert.equal(battleEntryWarmupDelay({ ...ready, restoringSession: true }), null);
    assert.equal(battleEntryWarmupDelay({ ...ready, hasCharacter: false }), null);
    assert.equal(battleEntryWarmupDelay({ ...ready, onboardingStep: "firstMission" }), null);
    assert.equal(battleEntryWarmupDelay({ ...ready, saveData: true }), null);
});

test("likely combat entry retains warmup, including legacy completed accounts", () => {
    for (const screen of ["worldMap", "arenaDistrict", "arena", "battleTowers", "villageWar", "villageWarMap", "clanWar2v2"] as const) {
        assert.equal(battleEntryWarmupDelay({ ...ready, screen }), 650);
    }
    assert.equal(battleEntryWarmupDelay({ ...ready, onboardingStep: undefined }), 650);
});

test("an actual PvP launch or restored battle loads immediately even on data saver", () => {
    assert.equal(battleEntryWarmupDelay({ ...ready, screen: "pvpBattle", restoringSession: true, hasCharacter: false, saveData: true }), 0);
});
