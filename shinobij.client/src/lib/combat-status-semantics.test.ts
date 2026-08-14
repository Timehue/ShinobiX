import assert from "node:assert/strict";
import test from "node:test";
import { combatStatusDuration, combatStatusSemantics } from "./combat-status-semantics";

test("classifies control and explains its source and cleanse rule", () => {
    assert.deepEqual(combatStatusSemantics({ name: "Stun", kind: "negative", source: "Thunder Prison" }), {
        category: "Control",
        icon: "◎",
        source: "Thunder Prison",
        removal: "Cleanse removes",
        effect: "Reduces the next action window",
    });
});

test("distinguishes shield effects and self-protecting removal locks", () => {
    assert.equal(combatStatusSemantics({ name: "Reflect", kind: "positive" }).category, "Shield");
    assert.equal(combatStatusSemantics({ name: "Clear Prevent", kind: "positive" }).removal, "Expires naturally");
});

test("keeps an honest fallback for legacy statuses without origin metadata", () => {
    assert.deepEqual(combatStatusSemantics({ name: "Unknown Field", kind: undefined }), {
        category: "Neutral",
        icon: "•",
        source: "Combat effect",
        removal: "Expires naturally",
        effect: "Changes combat state",
    });
});

test("reports independent stack expiries as a truthful range", () => {
    assert.equal(combatStatusDuration(1, 3), "1\u20133 rounds");
    assert.equal(combatStatusDuration(1, 3, true), "1\u20133r");
    assert.equal(combatStatusDuration(1, 1), "1 round");
});
