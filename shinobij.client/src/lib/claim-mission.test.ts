import assert from "node:assert/strict";
import test from "node:test";
import { claimHttpFailureMessage, postClaimMission } from "./claim-mission";
import { missionClaimActionScope, remainingActionDeadline } from "./action-deadline-store";

test("mission claims preserve HTTP rate-limit details and start a scoped deadline", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    const playerName = `claim-http-${Date.now()}`;
    globalThis.fetch = (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
            error: "You're going a little fast — try again in 2s.",
            code: "RATE_LIMITED",
            retryAfterMs: 2_000,
            requestId: "claim-request-12345678",
        }), { status: 429, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const result = await postClaimMission(playerName, "field", "fetch-d-supply-trail");
        assert.ok(result && result.ok === false);
        assert.equal(result.status, 429);
        assert.equal(result.code, "RATE_LIMITED");
        assert.equal(result.retryAfterMs, 2_000);
        assert.equal(result.requestId, "claim-request-12345678");
        assert.match(claimHttpFailureMessage(result), /cooling down.*2s/i);
        assert.equal(body?.missionType, "field");
        assert.ok(remainingActionDeadline(missionClaimActionScope(playerName), Date.now()) > 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("mission claims retain non-rate-limit server reasons", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
        error: "This contract is not accepted.",
        reason: "not-accepted",
        errorCode: "MISSION_STATE_INVALID",
    }), { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
        const result = await postClaimMission("claim-reason-player", "field", "fetch-d-supply-trail");
        assert.ok(result && result.ok === false);
        assert.equal(result.reason, "not-accepted");
        assert.equal(result.code, "MISSION_STATE_INVALID");
        assert.equal(result.error, "This contract is not accepted.");
        assert.equal(claimHttpFailureMessage(result), "This contract is not accepted.");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("claim network failures stay distinguishable from HTTP success", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    try {
        assert.equal(await postClaimMission("claim-offline-player", "field", "fetch-d-supply-trail"), null);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
