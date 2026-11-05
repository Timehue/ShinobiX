import { test } from "node:test";
import assert from "node:assert/strict";
import { FORGOT_PASSWORD_HINT, saveLoadFailure, verifyPlayerCredentials } from "./player-login";

// A save pull can fail three ways and they need three different answers. The
// bug this pins: 401 (the session token expired) was falling into the same
// branch as everything else and telling the player "No save found for that
// name. Check spelling or create a new character." — advice that, followed,
// would have had them abandon a character that was never in any danger.

test("401 and 403 are the credential dying, not the save", () => {
    assert.equal(saveLoadFailure(401), "expired");
    assert.equal(saveLoadFailure(403), "expired");
});

test("404 is the only status that means the save is really gone", () => {
    assert.equal(saveLoadFailure(404), "no-save");
});

test("server-side failures never claim anything about the save", () => {
    for (const status of [500, 502, 503, 429, 413]) {
        assert.equal(saveLoadFailure(status), "unreachable", `status ${status}`);
    }
});

// A wrong password answers 200 { ok: false }. Before 2026-11-04 every other
// refusal (a 500, a second 503 during maintenance) also told the player their
// name or password was wrong, and some of them went off to reset it.
async function verifyAgainst(status: number, body: unknown) {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
    try { return { verdict: await verifyPlayerCredentials("kaze", "pw", () => true), calls }; }
    finally { globalThis.fetch = real; }
}

test("a wrong password still gets the password hint", async () => {
    const { verdict } = await verifyAgainst(200, { ok: false });
    assert.deepEqual(verdict, { status: "rejected", message: FORGOT_PASSWORD_HINT });
});

test("a server failure is not reported as a wrong password", async () => {
    const { verdict } = await verifyAgainst(500, {});
    assert.equal(verdict.status, "rejected");
    assert.notEqual((verdict as { message: string }).message, FORGOT_PASSWORD_HINT);
});

test("maintenance is named after one retry instead of blaming the connection", async () => {
    const error = "Shinobi Journey is down for maintenance. Please try again in a few minutes.";
    const { verdict, calls } = await verifyAgainst(503, { ok: false, code: "maintenance_mode", error });
    assert.equal(calls, 2);
    assert.deepEqual(verdict, { status: "rejected", message: error });
});