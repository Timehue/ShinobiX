import { test } from "node:test";
import assert from "node:assert/strict";
import { recordEchoesWitnessChoice } from "./_echoes-witness.js";
import { ECHOES_WITNESS_ERAS } from "../../shared/echoes-witness.js";
import { ECHOES_TITLES, isServerCreditedTitle } from "../_titles-registry.js";

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

test("the fourth seal closes Chapter One with a server-credited title, once", () => {
    // Chapter One used to end on the floor list with nothing to mark it.
    const echoesOfWar = Object.fromEntries(ECHOES_WITNESS_ERAS.map((era) => [era.closeEncounterId, { wins: 1 }]));
    const [last, ...earlier] = [...ECHOES_WITNESS_ERAS].reverse();
    const character: Record<string, unknown> = {
        echoesOfWar,
        echoesWitnessChoices: Object.fromEntries(earlier.map((era) => [era.id, era.choices[0]])),
        serverTitles: ["Pactbound"],
    };
    const third = recordEchoesWitnessChoice(character, earlier[0].id, earlier[0].choices[0]);
    assert.equal(third.ok && third.grantedTitles.length, 0, "an earlier age closes nothing");

    const closed = recordEchoesWitnessChoice(character, last.id, last.choices[0]);
    assert.equal(closed.ok, true);
    if (!closed.ok) return;
    assert.deepEqual(closed.grantedTitles, [ECHOES_TITLES.chapterOne]);
    assert.deepEqual(closed.character.serverTitles, ["Pactbound", ECHOES_TITLES.chapterOne]);
    assert.equal(isServerCreditedTitle(ECHOES_TITLES.chapterOne), true, "a tampered save cannot claim it");

    const retry = recordEchoesWitnessChoice(closed.character, last.id, last.choices[0]);
    assert.equal(retry.ok && retry.grantedTitles.length, 0);
    assert.equal(retry.ok && retry.write, false);

    // A seal that landed before this title existed repairs it on the next retry.
    const { serverTitles: _dropped, ...legacy } = closed.character;
    const repaired = recordEchoesWitnessChoice(legacy, last.id, last.choices[0]);
    assert.equal(repaired.ok && repaired.write, true);
    assert.deepEqual(repaired.ok && repaired.grantedTitles, [ECHOES_TITLES.chapterOne]);
});

test("cross-age and unknown answers fail closed", () => {
    const complete = { echoesOfWar: { "echoes-3-aya": { wins: 1 } } };
    assert.equal(recordEchoesWitnessChoice(complete, "echoes-age-1", "who-paid").ok, false);
    assert.equal(recordEchoesWitnessChoice(complete, "echoes-age-99", "warnings-first").ok, false);
});
