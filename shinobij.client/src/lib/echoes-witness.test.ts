import { test } from "node:test";
import assert from "node:assert/strict";
import { echoesConclusionPending, recordEchoesWitness } from "./echoes-witness";

test("a server clear with no cosmetic post flag recovers the conclusion", () => {
    assert.equal(echoesConclusionPending(1, undefined), true);
    assert.equal(echoesConclusionPending(1, true), false);
    assert.equal(echoesConclusionPending(0, undefined), false);
});

test("the witness client accepts an authoritative sealed response", async () => {
    let init: RequestInit | undefined;
    const result = await recordEchoesWitness("Mika", "echoes-age-1", "names-first", async (_url, request) => {
        init = request;
        return new Response(JSON.stringify({
            ok: true,
            eraId: "echoes-age-1",
            choiceId: "names-first",
            choices: { "echoes-age-1": "names-first" },
            alreadySealed: false,
            character: { name: "Mika", echoesWitnessChoices: { "echoes-age-1": "names-first" } },
            _saveVersion: 8,
        }), { status: 200 });
    });
    assert.equal(result.choiceId, "names-first");
    assert.equal(result.saveVersion, 8);
    assert.equal(init?.credentials, "same-origin");
});

test("the witness client rejects foreign, stale-shaped, and mismatched receipts", async () => {
    for (const body of [
        { ok: true, eraId: "echoes-age-1", choiceId: "names-first", choices: { "echoes-age-1": "names-first" }, character: { name: "Other" }, _saveVersion: 8 },
        { ok: true, eraId: "echoes-age-1", choiceId: "names-first", choices: { "echoes-age-1": "warnings-first" }, character: { name: "Mika" }, _saveVersion: 8 },
        { ok: true, eraId: "echoes-age-2", choiceId: "who-paid", choices: { "echoes-age-2": "who-paid" }, character: { name: "Mika" }, _saveVersion: 8 },
    ]) {
        await assert.rejects(recordEchoesWitness("Mika", "echoes-age-1", "names-first", async () => new Response(JSON.stringify(body), { status: 200 })), /could not be verified/);
    }
});
