import assert from "node:assert/strict";
import test from "node:test";
import { unavailableCompanionSummonCopy } from "./companion-summon-copy";

test("an explicitly locked sub-50 active pet explains its exact PvE summon unlock", () => {
    assert.deepEqual(unavailableCompanionSummonCopy({ level: 1, unlockedForPve: false }), {
        short: "Unlocks at pet Lv 50 · currently Lv 1",
        title: "This active pet is still locked for PvE summons. It unlocks at pet level 50; currently level 1.",
    });
});

test("every other absent server seal keeps generic copy", () => {
    assert.equal(unavailableCompanionSummonCopy(undefined).short, "No eligible active pet");
    assert.equal(unavailableCompanionSummonCopy({ level: 49 }).short, "No eligible active pet");
    assert.equal(unavailableCompanionSummonCopy({ level: 50, unlockedForPve: false }).short, "No eligible active pet");
    assert.equal(unavailableCompanionSummonCopy({ level: 1, unlockedForPve: true }).short, "No eligible active pet");
});
