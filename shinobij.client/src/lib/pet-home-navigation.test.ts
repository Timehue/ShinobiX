import assert from "node:assert/strict";
import { test } from "node:test";
import { isPetHomeScreen, petHomeReturnLabel } from "./pet-home-navigation";

test("Pet Home treats its care and combat routes as one destination", () => {
    assert.equal(isPetHomeScreen("home"), true);
    assert.equal(isPetHomeScreen("pets"), true);
    assert.equal(isPetHomeScreen("petArena"), true);
    assert.equal(isPetHomeScreen("petColiseum"), true);
    assert.equal(isPetHomeScreen("centralHub"), false);
    assert.equal(isPetHomeScreen("hollowGateShrine"), false);
});

test("Pet Home return copy names Central and the Hollow Gate precisely", () => {
    assert.equal(petHomeReturnLabel("centralHub"), "Central · The Gates");
    assert.equal(petHomeReturnLabel("hollowGateShrine"), "Hollow Gate Shrine");
    assert.equal(petHomeReturnLabel("village"), "Village");
});
