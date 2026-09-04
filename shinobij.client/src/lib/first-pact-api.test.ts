import assert from "node:assert/strict";
import test from "node:test";
import { createFirstPactProgress } from "../../../shared/first-pact-contract.js";
import { advanceFirstPactMain } from "./first-pact-api.js";

test("a rejected story action still returns the server's authoritative progress", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = originalFetch; });
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
