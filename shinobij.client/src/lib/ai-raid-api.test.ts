import assert from "node:assert/strict";
import test from "node:test";
import { completeAiRaidLaunch, mintAiRaidToken } from "./ai-raid-api";

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
        const proof = await mintAiRaidToken({ playerName: "Rill O'Neil", opponentId: "guard-ash", sector: 66 });
        assert.equal(proof?.token, "raid-proof-123");
        assert.equal(proof?.opponentId, "guard-ash");
        assert.match(String(body?.requestId), /^[A-Za-z0-9_-]{8,96}$/);
        assert.deepEqual(body && { ...body, requestId: "<stable>" }, { playerName: "Rill O'Neil", aiId: "guard-ash", sector: 66, requestId: "<stable>" });
        completeAiRaidLaunch("Rill O'Neil", "raid-proof-123");
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
        assert.equal(await mintAiRaidToken({ playerName: "Retry Rill", opponentId: "client-guard", sector: 61 }), null);
        const replay = await mintAiRaidToken({ playerName: "retryrill", opponentId: "client-guard", sector: 61 });
        assert.equal(replay?.opponentId, "server-guard");
        assert.equal(replay?.sector, 61);
        assert.equal(replay?.replayed, true);
        assert.equal(bodies[0].requestId, bodies[1].requestId);
        completeAiRaidLaunch("Retry Rill", "raid-proof-replayed");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("AI raid proof fails closed when the server does not issue a token", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, token: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    try {
        assert.equal(await mintAiRaidToken({ playerName: "Rill", opponentId: "guard", sector: 40 }), null);
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
        assert.equal((await mintAiRaidToken({ playerName: "Expired Raid Rill", opponentId: "guard", sector: 40 }))?.token, "raid-proof-aging");
        assert.equal(await mintAiRaidToken({ playerName: "Expired Raid Rill", opponentId: "guard", sector: 40 }), null);
        assert.equal(requestIds[1], requestIds[0], "the terminal response must identify the exact parked request");
        const fresh = await mintAiRaidToken({ playerName: "Expired Raid Rill", opponentId: "guard", sector: 40 });
        assert.equal(fresh?.token, "raid-proof-fresh");
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
        await mintAiRaidToken({ playerName: "Spent Raid Rill", opponentId: "guard", sector: 40 });
        assert.equal(await mintAiRaidToken({ playerName: "Spent Raid Rill", opponentId: "guard", sector: 40 }), null);
        const fresh = await mintAiRaidToken({ playerName: "Spent Raid Rill", opponentId: "guard", sector: 40 });
        assert.notEqual(requestIds[2], requestIds[1]);
        if (fresh) completeAiRaidLaunch("Spent Raid Rill", fresh.token);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
