import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ECHOES_WITNESS_ERAS,
    isEchoesWitnessChoice,
    normalizeEchoesBattleBeat,
    normalizeEchoesWitnessChoices,
} from "./echoes-witness.js";

test("the witness contract keeps one bounded choice list for every age", () => {
    assert.equal(ECHOES_WITNESS_ERAS.length, 4);
    assert.equal(new Set(ECHOES_WITNESS_ERAS.map(({ closeEncounterId }) => closeEncounterId)).size, 4);
    for (const era of ECHOES_WITNESS_ERAS) {
        assert.equal(era.choices.length, 3);
        assert.equal(new Set(era.choices).size, 3);
        assert.ok(era.choices.every((choice) => isEchoesWitnessChoice(era.id, choice)));
    }
    assert.equal(isEchoesWitnessChoice("echoes-age-1", "who-paid"), false);
});

test("old, hostile, and future save values normalize without trapping old saves", () => {
    assert.deepEqual(normalizeEchoesWitnessChoices(undefined), {});
    assert.deepEqual(normalizeEchoesWitnessChoices({
        "echoes-age-1": "warnings-first",
        "echoes-age-2": "warnings-first",
        "future-age": "verdict-open",
    }), { "echoes-age-1": "warnings-first" });
    assert.equal(normalizeEchoesBattleBeat("recovered-ground"), "recovered-ground");
    assert.equal(normalizeEchoesBattleBeat("won-because-clever"), "unrecorded");
});
