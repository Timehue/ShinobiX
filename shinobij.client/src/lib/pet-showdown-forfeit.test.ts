import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFirstPactProgress } from "../../../shared/first-pact-contract.js";
import { forfeitFirstPactShowdown, forfeitShowdown } from "./pet-showdown-api.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
});

test("a First Pact concession retains the returned reset and sends the sealed session", async () => {
    const progress = { ...createFirstPactProgress(1), courtStanding: 750,
        standingCourt: { round: 0, best: 3, clears: 0, battleProofs: ["showdown:sealed"] } };
    let requests = 0;
    globalThis.fetch = async (input, init) => {
        requests++;
        assert.equal(input, "/api/pet/showdown");
        assert.deepEqual(JSON.parse(String(init?.body)), { action: "forfeit", playerName: "Rin", sessionId: "sealed" });
        return json({ ok: true, firstPact: { progress } });
    };
    assert.deepEqual(await forfeitFirstPactShowdown("Rin", "sealed"), { progress });
    assert.equal(requests, 1);
});

test("an expired concession reads current progress and preserves its versioned completion grant", async () => {
    const progress = createFirstPactProgress(1);
    const character = { name: "Rin", auraStones: 19 };
    const paths: string[] = [];
    globalThis.fetch = async (input) => {
        paths.push(String(input));
        return paths.length === 1 ? json({ ok: true }) : json({ ok: true, progress, character, _saveVersion: 12 });
    };
    assert.deepEqual(await forfeitFirstPactShowdown("Rin", "expired"), { progress, character, _saveVersion: 12 });
    assert.deepEqual(paths, ["/api/pet/showdown", "/api/first-pact/state"]);
});

test("a failed concession or recovery read stays recoverable", async () => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; return json({ error: "Busy" }, 503); };
    assert.ok("error" in await forfeitFirstPactShowdown("Rin", "sealed"));
    assert.equal(requests, 1);
    globalThis.fetch = async () => (++requests === 2 ? json({ ok: true }) : json({ error: "Try again" }, 503));
    assert.deepEqual(await forfeitFirstPactShowdown("Rin", "expired"), { error: "Try again" });
    globalThis.fetch = async () => { throw new Error("Disconnected"); };
    assert.ok("error" in await forfeitFirstPactShowdown("Rin", "sealed"));
});

test("ordinary Showdown callers retain their boolean concession contract", async () => {
    globalThis.fetch = async () => json({ ok: true });
    assert.equal(await forfeitShowdown("Rin", "ordinary"), true);
    globalThis.fetch = async () => json({}, 503);
    assert.equal(await forfeitShowdown("Rin", "ordinary"), false);
});

test("a malformed success response does not dismiss an unconfirmed concession", async () => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response("<html>Proxy page</html>"); };
    assert.ok("error" in await forfeitFirstPactShowdown("Rin", "sealed"));
    assert.equal(requests, 1);
});
