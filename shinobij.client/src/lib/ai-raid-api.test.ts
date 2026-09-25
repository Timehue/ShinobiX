import assert from "node:assert/strict";
import test from "node:test";
import { aiRaidLaunchFailureMessage, completeAiRaidLaunch, mintAiRaidToken } from "./ai-raid-api";
import { raidStartActionScope, remainingActionDeadline } from "./action-deadline-store";

test("AI raid proof is bound to the exact player, opponent, and sector", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, requestId: body?.requestId, token: "raid-proof-123", opponentId: "guard-ash", sector: 66, replayed: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const result = await mintAiRaidToken({ playerName: "Rill O'Neil", opponentId: "guard-ash", sector: 66 });
        assert.ok(result.ok);
        assert.equal(result.token, "raid-proof-123");
        assert.equal(result.opponentId, "guard-ash");
        assert.match(String(body?.requestId), /^[A-Za-z0-9_-]{8,96}$/);
        assert.deepEqual(body && { ...body, requestId: "<stable>" }, { playerName: "Rill O'Neil", aiId: "guard-ash", sector: 66, requestId: "<stable>" });
        completeAiRaidLaunch("Rill O'Neil", "raid-proof-123");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("field mission outpost launches carry mission identity instead of a client-selected opponent", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
            ok: true, requestId: body.requestId, token: "mission-outpost-proof-01",
            opponentId: "server-authored-outpost", sector: 18, source: "field-mission-raid",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const result = await mintAiRaidToken({
            playerName: "Mission Rill", opponentId: "", missionId: "fetch-d-supply-trail", sector: 18,
        });
        assert.ok(result.ok);
        assert.equal(body?.missionId, "fetch-d-supply-trail");
        assert.equal(body?.aiId, undefined, "the request cannot choose a weaker mission opponent");
        completeAiRaidLaunch("Mission Rill", "mission-outpost-proof-01");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("lost raid-mint ACK retries the same operation id and adopts sealed identity", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    let attempt = 0;
    globalThis.fetch = (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        attempt += 1;
        if (attempt === 1) throw new Error("lost ACK");
        return new Response(JSON.stringify({
            ok: true,
            requestId: bodies.at(-1)?.requestId,
            token: "raid-proof-replayed",
            opponentId: "server-guard",
            sector: 61,
            source: "published-raid",
            replayed: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const lostAck = await mintAiRaidToken({ playerName: "Retry Rill", opponentId: "client-guard", sector: 61 });
        assert.equal(lostAck.ok, false);
        if (lostAck.ok) assert.fail("a lost ACK must not report success");
        assert.equal(lostAck.reason, "network-error");
        assert.ok(lostAck.requestId);
        const replay = await mintAiRaidToken({ playerName: "retryrill", opponentId: "client-guard", sector: 61 });
        assert.ok(replay.ok);
        assert.equal(replay.opponentId, "server-guard");
        assert.equal(replay.sector, 61);
        assert.equal(replay.replayed, true);
        assert.equal(bodies[0].requestId, bodies[1].requestId);
        completeAiRaidLaunch("Retry Rill", replay.token);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("HTTP 200 daily-cap response without a token retains its retry deadline", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
            ok: true,
            requestId: body.requestId,
            reason: "daily-mint-cap",
            retryAfterMs: 3_600_000,
            token: null,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const result = await mintAiRaidToken({ playerName: "Rill", opponentId: "guard", sector: 40 });
        assert.equal(result.ok, false);
        if (result.ok) assert.fail("a missing token must not report success");
        assert.equal(result.status, 200);
        assert.equal(result.reason, "daily-mint-cap");
        assert.equal(result.retryAfterMs, 3_600_000);
        assert.ok(remainingActionDeadline(raidStartActionScope("Rill"), Date.now()) > 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("expired or spent raid launches retire only the exact dead request", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    const requestIds: string[] = [];
    let attempt = 0;
    globalThis.fetch = (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const requestId = String(body.requestId);
        requestIds.push(requestId);
        attempt += 1;
        if (attempt === 1) {
            return new Response(JSON.stringify({
                ok: true, requestId, token: "raid-proof-aging", opponentId: "guard", sector: 40,
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (attempt === 2) {
            return new Response(JSON.stringify({
                error: "That raid launch expired before combat began.", reason: "raid-launch-expired", requestId,
            }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
            ok: true, requestId, token: "raid-proof-fresh", opponentId: "guard", sector: 40,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const first = await mintAiRaidToken({ playerName: "Expired Raid Rill", opponentId: "guard", sector: 40 });
        assert.ok(first.ok);
        assert.equal(first.token, "raid-proof-aging");
        const expired = await mintAiRaidToken({ playerName: "Expired Raid Rill", opponentId: "guard", sector: 40 });
        assert.equal(expired.ok, false);
        if (expired.ok) assert.fail("an expired launch must not report success");
        assert.equal(expired.reason, "raid-launch-expired");
        assert.equal(requestIds[1], requestIds[0], "the terminal response must identify the exact parked request");
        const fresh = await mintAiRaidToken({ playerName: "Expired Raid Rill", opponentId: "guard", sector: 40 });
        assert.ok(fresh.ok);
        assert.equal(fresh.token, "raid-proof-fresh");
        assert.notEqual(requestIds[2], requestIds[1], "the next click must mint a new id instead of replaying the dead launch for 45 minutes");
        completeAiRaidLaunch("Expired Raid Rill", "raid-proof-fresh");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("a spent raid launch also releases its parked client request", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    const requestIds: string[] = [];
    let attempt = 0;
    globalThis.fetch = (async (_input, init) => {
        const requestId = String((JSON.parse(String(init?.body)) as Record<string, unknown>).requestId);
        requestIds.push(requestId);
        attempt += 1;
        if (attempt === 2) {
            return new Response(JSON.stringify({ reason: "raid-launch-spent", requestId }), {
                status: 409, headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify({ ok: true, requestId, token: `raid-proof-${attempt}`, opponentId: "guard", sector: 40 }), {
            status: 200, headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const first = await mintAiRaidToken({ playerName: "Spent Raid Rill", opponentId: "guard", sector: 40 });
        assert.ok(first.ok);
        const spent = await mintAiRaidToken({ playerName: "Spent Raid Rill", opponentId: "guard", sector: 40 });
        assert.equal(spent.ok, false);
        if (spent.ok) assert.fail("a spent launch must not report success");
        assert.equal(spent.reason, "raid-launch-spent");
        const fresh = await mintAiRaidToken({ playerName: "Spent Raid Rill", opponentId: "guard", sector: 40 });
        assert.ok(fresh.ok);
        assert.notEqual(requestIds[2], requestIds[1]);
        completeAiRaidLaunch("Spent Raid Rill", fresh.token);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("HTTP 429 raid errors preserve code, retry deadline, and stable request identity", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ error: "You're going a little fast — try again in 2s.", code: "RATE_LIMITED", retryAfterMs: 2_000 }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const result = await mintAiRaidToken({ playerName: "Limited Raid Rill", opponentId: "guard", sector: 40 });
        assert.equal(result.ok, false);
        if (result.ok) assert.fail("a rate-limited mint must not report success");
        assert.equal(result.status, 429);
        assert.equal(result.code, "RATE_LIMITED");
        assert.equal(result.retryAfterMs, 2_000);
        assert.equal(result.requestId, body?.requestId);
        assert.ok(remainingActionDeadline(raidStartActionScope("Limited Raid Rill"), Date.now()) > 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("raid failures show distinct messages for the server's location, battle, and launch reasons", () => {
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 429, requestId: "r", reason: "RATE_LIMITED", code: "RATE_LIMITED", retryAfterMs: 2_000 }), /cooling down.*2s/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 200, requestId: "r", reason: "daily-mint-cap" }), /cap.*midnight UTC/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 409, requestId: "r", reason: "sector-mismatch" }), /travel.*sector/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 409, requestId: "r", reason: "mission-raid-objective-not-ready" }), /sweeps before.*outpost/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 409, requestId: "r", reason: "mission-raid-encounter-unavailable" }), /authored outpost opponent/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 409, requestId: "r", reason: "tower-battle-active" }), /active battle/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 409, requestId: "r", reason: "raid-launch-expired" }), /expired/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 409, requestId: "r", reason: "raid-launch-spent" }), /already been used/i);
    assert.match(aiRaidLaunchFailureMessage({ ok: false, status: 0, requestId: "r", reason: "network-error" }), /request is saved/i);
});
