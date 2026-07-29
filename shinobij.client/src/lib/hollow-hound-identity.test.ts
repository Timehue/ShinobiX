import assert from "node:assert/strict";
import test from "node:test";
import {
    HOLLOW_HOUND_MODEL_SOURCE_ID,
    hollowHoundEncounterId,
    isHollowHoundEncounterId,
    isHollowHoundEncounterPet,
} from "../../../shared/hollow-gate-contract";

test("Hollow Hounds use a dedicated encounter identity", () => {
    const id = hollowHoundEncounterId(1234567890123);
    assert.equal(id, "hollow-hound-encounter-1234567890123");
    assert.equal(isHollowHoundEncounterId(id), true);
    assert.equal(isHollowHoundEncounterId(hollowHoundEncounterId(7)), true);
    assert.equal(isHollowHoundEncounterPet({ id, name: "Shrineback Hollow Hound" }), true);
});

test("owned Oni Hounds never inherit the Hollow Hound identity or surface", () => {
    assert.equal(HOLLOW_HOUND_MODEL_SOURCE_ID, "mythic-4");
    assert.equal(isHollowHoundEncounterPet({ id: "mythic-4", name: "Abyssal Oni Hound" }), false);
    assert.equal(isHollowHoundEncounterPet({ id: "mythic-4-1234567890123", name: "Abyssal Oni Hound" }), false);
});

test("legacy sealed Hollow Hounds remain recognizable without matching ordinary Oni Hounds", () => {
    assert.equal(isHollowHoundEncounterPet({ id: "mythic-4-1234567890123", name: "Hollow Hound Alpha" }), true);
    assert.equal(isHollowHoundEncounterPet({ id: "mythic-4-1234567890123", name: "Alpha's Fang" }), true);
});
