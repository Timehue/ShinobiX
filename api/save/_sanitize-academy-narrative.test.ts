import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeCharacterSave } from "./[name].js";

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char | null) => sanitizeCharacterSave(
    { character: incoming }, existing ? { character: existing } : null,
).character as Record<string, unknown>;

test("Academy narrative fields preserve authored values and remain non-economic", () => {
    const out = sanitize({
        academyVow: "seeker",
        academyIncidentSeen: true,
        academyTraceSector: 17,
        academyFieldSeal: true,
        onboardingStep: "done",
    }, {});
    assert.equal(out.academyVow, "seeker");
    assert.equal(out.academyIncidentSeen, true);
    assert.equal(out.academyTraceSector, 17);
    assert.equal(out.academyFieldSeal, true);
    assert.equal(out.onboardingStep, "done");
});

test("Academy narrative values are bounded at the save boundary", () => {
    const out = sanitize({
        academyVow: { forged: true },
        academyIncidentSeen: "yes",
        academyTraceSector: 9_000_000,
        academyFieldSeal: 1,
    }, {});
    assert.equal("academyVow" in out, false);
    assert.equal(out.academyIncidentSeen, false);
    assert.equal(out.academyTraceSector, 10_000);
    assert.equal(out.academyFieldSeal, false);
});

test("a stale invalid vow cannot overwrite the player's stored authored vow", () => {
    const out = sanitize({ academyVow: "power" }, { academyVow: "guardian" });
    assert.equal(out.academyVow, "guardian");
});
