import { test } from "node:test";
import assert from "node:assert/strict";
import { showdownMatchupElement } from "./showdown-hud";

test("neutral Swift Strike never inherits its Fire user's resisted matchup", () => {
    assert.equal(showdownMatchupElement({ element: "None", kind: "damage", power: 34 }, "Fire"), undefined);
});

test("coverage and damaging control techniques use their own element", () => {
    assert.equal(showdownMatchupElement({ element: "Water", kind: "damage", power: 80 }, "Fire"), "Water");
    assert.equal(showdownMatchupElement({ element: "Fire", kind: "burn", power: 40 }, "Fire"), "Fire");
});

test("support, non-damaging control and non-move selections clear the wheel cue", () => {
    for (const kind of ["heal", "shield", "barrier", "protect", "weather", "buff", "taunt", "absorb"]) {
        assert.equal(showdownMatchupElement({ element: "Fire", kind, power: 80 }, "Fire"), undefined, kind);
    }
    assert.equal(showdownMatchupElement({ element: "Fire", kind: "mark", power: 0 }, "Fire"), undefined);
    assert.equal(showdownMatchupElement(null, "Fire"), undefined);
});
