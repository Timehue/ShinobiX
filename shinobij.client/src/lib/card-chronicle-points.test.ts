import { test } from "node:test";
import assert from "node:assert/strict";
import { cardChroniclePointsLine, parseCardChroniclePoints } from "./card-chronicle-points";
import { hollowGateCardWinLogLine } from "./hollow-gate-card-return";

test("a card duel result names the Chronicle Points the server paid", () => {
    assert.equal(cardChroniclePointsLine({ earned: 20, status: "paid", pairWeight: 1 }), "+20 Chronicle Points.");
    assert.equal(
        cardChroniclePointsLine({ earned: 10, status: "paid", pairWeight: 0.5 }),
        "+10 Chronicle Points. Repeat opponent today, so the reward is reduced.",
    );
    assert.equal(cardChroniclePointsLine({ earned: 15, status: "paid" }), "+15 Chronicle Points.", "the garrison has no opponent count");
    assert.equal(cardChroniclePointsLine({ earned: 8, status: "pending", pairWeight: 1 }), "+8 Chronicle Points are being recorded.");
    assert.equal(cardChroniclePointsLine({ earned: 0, status: "pending" }), "Chronicle Points are being recorded.");
});

test("a duel that paid nothing says why, with the server's own thresholds", () => {
    assert.equal(
        cardChroniclePointsLine({ earned: 0, status: "none", reason: "participation", rules: { minSeconds: 45, minActionsPerSide: 3, minTurn: 3 } }),
        "No Chronicle Points: a duel counts when it reaches turn 3, lasts 45 seconds, has 3 plays from each side, and ends without a forfeit or timeout.",
    );
    assert.match(String(cardChroniclePointsLine({ earned: 0, status: "none", reason: "reciprocal" })), /traded back and forth/);
    assert.match(String(cardChroniclePointsLine({ earned: 0, status: "none", reason: "repeat", pairWeight: 0 })), /paid all they can today/);
    assert.equal(cardChroniclePointsLine({ earned: 0, status: "none" }), null);
    assert.equal(cardChroniclePointsLine(null), null);
});

test("a reply's Chronicle Point result is read defensively", () => {
    assert.deepEqual(parseCardChroniclePoints({ earned: 20, status: "paid", pairWeight: 1 }), { earned: 20, status: "paid", pairWeight: 1 });
    for (const junk of [undefined, null, 5, "20", [], { earned: -1, status: "paid" }, { earned: 3, status: "maybe" }, { status: "paid" }]) {
        assert.equal(parseCardChroniclePoints(junk), null, JSON.stringify(junk));
    }
});

test("a won Rift card ambush logs its Chronicle Points beside the ryo and Aura Dust", () => {
    assert.equal(
        hollowGateCardWinLogLine({ ryo: 485, auraDust: 3, chroniclePoints: 10 }),
        "The Chronicle Keeper falls. The card ambush seal breaks. +485 ryo, +3 Aura Dust, +10 Chronicle Points.",
    );
    assert.equal(
        hollowGateCardWinLogLine({ ryo: 485, auraDust: 3 }),
        "The Chronicle Keeper falls. The card ambush seal breaks. +485 ryo, +3 Aura Dust.",
        "a result settled before the points existed reads as before",
    );
});
