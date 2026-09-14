import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFirstPactProgress } from "../../../shared/first-pact-contract.js";
import { advanceFirstPactMain, fetchFirstPactProgress } from "./first-pact-api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("a rejected story action still returns the server's authoritative progress", async () => {
    const progress = {
        ...createFirstPactProgress(10),
        mainStep: "challenge-court-menagerie" as const,
        flags: ["crossed-celestial-threshold"],
    };
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: "That moment is not available in the current chapter.",
        progress,
    }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
    });

    const result = await advanceFirstPactMain("test-player", "meet-scribe");
    assert.ok("error" in result);
    assert.equal(result.progress?.mainStep, "challenge-court-menagerie");
});

test("completion responses retain the authoritative character and safe save version", async () => {
    const progress = { ...createFirstPactProgress(1), mainStep: "complete" as const, chapter: 4 as const };
    globalThis.fetch = async () => new Response(JSON.stringify({
        ok: true,
        progress,
        character: { name: "Rin", auraStones: 19, serverTitles: ["Pactbound"] },
        _saveVersion: 12,
        grantedAuraStones: 15,
        grantedTitles: ["Pactbound"],
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    const result = await advanceFirstPactMain("Rin", "complete-crossing");
    assert.equal("error" in result, false);
    if ("error" in result) return;
    assert.equal(result.character?.name, "Rin");
    assert.equal(result.character?.auraStones, 19);
    assert.equal(result._saveVersion, 12);
    assert.equal(result.grantedAuraStones, 15);
});

test("a character without its exact version is not exposed as authoritative", async () => {
    const progress = { ...createFirstPactProgress(1), mainStep: "complete" as const, chapter: 4 as const };
    globalThis.fetch = async () => new Response(JSON.stringify({
        ok: true,
        progress,
        character: { name: "Rin", auraStones: 19, serverTitles: ["Pactbound"] },
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    const result = await fetchFirstPactProgress("Rin");
    assert.equal("error" in result, false);
    if ("error" in result) return;
    assert.equal(result.character, undefined);
    assert.equal(result._saveVersion, undefined);
});
