import assert from "node:assert/strict";
import { test } from "node:test";
import { petArenaBackLabel, petArenaReturnScreen, petArenaStartIssue } from "./pet-arena-entry";

test("Pet Arena validates every setup requirement before battle presentation starts", () => {
    assert.equal(petArenaStartIssue({ opponentMode: "player" }), "Choose one of your pets first.");
    assert.match(petArenaStartIssue({ selectedPetName: "Sumi", selectedPetOnExpedition: true, opponentMode: "ai", opponentPetName: "Ember" }) ?? "", /Sumi is exploring/);
    assert.match(petArenaStartIssue({ selectedPetName: "Sumi", opponentMode: "player" }) ?? "", /No player pets found/);
    assert.match(petArenaStartIssue({ selectedPetName: "Sumi", opponentMode: "ai", opponentPetName: "Ember", opponentOnExpedition: true }) ?? "", /Ember is exploring/);
    assert.match(petArenaStartIssue({ selectedPetName: "Sumi", opponentMode: "ai", opponentPetName: "Ember", reserveRequired: true, reserveAvailable: false }) ?? "", /reserve pet/);
    assert.equal(petArenaStartIssue({ selectedPetName: "Sumi", opponentMode: "ai", opponentPetName: "Ember", reserveRequired: true, reserveAvailable: true }), null);
});

test("Pet Arena returns ordinary visits to companion care and preserves forced callers", () => {
    assert.equal(petArenaReturnScreen(), "pets");
    assert.equal(petArenaReturnScreen("hollowGateShrine"), "hollowGateShrine");
    assert.equal(petArenaBackLabel("pets"), "Back to Pet Yard");
    assert.equal(petArenaBackLabel("hollowGateShrine"), "Back to Shrine");
});
