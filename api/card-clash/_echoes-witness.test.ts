import { test } from "node:test";
import assert from "node:assert/strict";
import { recordEchoesWitnessChoice } from "./_echoes-witness.js";

test("a witness answer requires the server-owned close clear and seals once", () => {
    const locked = recordEchoesWitnessChoice({}, "echoes-age-1", "warnings-first");
    assert.deepEqual(locked, { ok: false, status: 409, error: "Finish this age before sealing its witness record." });

    const eligible = { echoesOfWar: { "echoes-3-aya": { wins: 1, firstClearAt: 10 } } };
    const first = recordEchoesWitnessChoice(eligible, "echoes-age-1", "warnings-first");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.write, true);
    assert.equal(first.choices["echoes-age-1"], "warnings-first");

    const conflictingRetry = recordEchoesWitnessChoice(first.character, "echoes-age-1", "names-first");
    assert.equal(conflictingRetry.ok, true);
    if (!conflictingRetry.ok) return;
    assert.equal(conflictingRetry.write, false);
    assert.equal(conflictingRetry.alreadySealed, true);
    assert.equal(conflictingRetry.choiceId, "warnings-first");
});

test("witness normalization migrates a bounded valid record on an idempotent retry", () => {
    const result = recordEchoesWitnessChoice({
        echoesOfWar: { "echoes-3-aya": { wins: 1 } },
        echoesWitnessChoices: { "echoes-age-1": "cause-open", injected: "anything" },
    }, "echoes-age-1", "cause-open");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.write, true);
    assert.deepEqual(result.character.echoesWitnessChoices, { "echoes-age-1": "cause-open" });
});

test("cross-age and unknown answers fail closed", () => {
    const complete = { echoesOfWar: { "echoes-3-aya": { wins: 1 } } };
    assert.equal(recordEchoesWitnessChoice(complete, "echoes-age-1", "who-paid").ok, false);
    assert.equal(recordEchoesWitnessChoice(complete, "echoes-age-99", "warnings-first").ok, false);
});
