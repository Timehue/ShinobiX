import assert from "node:assert/strict";
import test from "node:test";
import {
    joinTowerPvpQueue,
    settleAndLeaveTowerPvp,
    submitTowerPvpActionWithLostResponseRetry,
} from "./tower-pvp-api";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

test("MPvP action lost-response replay reuses one move token and optimistic revision", async () => {
    const originalFetch = globalThis.fetch;
    const commands: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (commands.length === 1) throw new TypeError("response lost");
        return jsonResponse({
            applied: true,
            replayed: true,
            currentVersion: 8,
            match: { combat: { actionVersion: 8 } },
        });
    };
    try {
        const result = await submitTowerPvpActionWithLostResponseRetry(
            "tpvp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "Hero",
            { type: "wait" },
            7,
        );
        assert.equal(result.applied, true);
        assert.equal(result.replayed, true);
        assert.equal(commands.length, 2);
        assert.equal(commands[0]?.moveToken, commands[1]?.moveToken);
        assert.equal(commands[0]?.expectedVersion, 7);
        assert.match(String(commands[0]?.moveToken), /^[A-Za-z0-9_-]{16,80}$/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("MPvP queue lost-response replay reuses one command request id", async () => {
    const originalFetch = globalThis.fetch;
    const commands: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (commands.length === 1) throw new TypeError("response lost");
        return jsonResponse({
            replayed: true,
            presence: { state: "idle", match: null, queuePosition: null },
        });
    };
    try {
        const result = await joinTowerPvpQueue("Hero");
        assert.equal(result.replayed, true);
        assert.equal(commands.length, 2);
        assert.equal(commands[0]?.requestId, commands[1]?.requestId);
        assert.match(String(commands[0]?.requestId), /^tpvp_queue_[A-Za-z0-9_-]+$/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("MPvP action conflicts return the projected authoritative combat revision", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({
        applied: false,
        replayed: false,
        reason: "stale-version",
        currentVersion: 9,
        match: {
            version: 9,
            combat: { actionVersion: 9, activeIndex: 2 },
        },
    }, 409);
    try {
        const result = await submitTowerPvpActionWithLostResponseRetry(
            "tpvp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "Hero",
            { type: "wait" },
            8,
        );
        assert.equal(result.applied, false);
        assert.equal(result.reason, "stale-version");
        assert.equal(result.currentVersion, 9);
        assert.equal(result.session.actionVersion, 9);
        assert.equal(result.session.activeIndex, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("terminal settlement clears the player pointer with a lost-response-safe leave", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ url, body });
        if (url.endsWith("/pvp-settle")) {
            return jsonResponse({
                settled: true,
                replayed: false,
                progressionApplied: false,
                rewards: { ryo: 0, xp: 0, fateShards: 0, rating: 0 },
                match: {
                    matchId: "tpvp-cccccccccccccccccccccccccccccccc",
                    version: 11,
                    combat: { actionVersion: 11 },
                },
            });
        }
        if (calls.filter(call => call.url.endsWith("/pvp-queue")).length === 1) {
            throw new TypeError("leave response lost");
        }
        return jsonResponse({
            replayed: true,
            match: null,
            presence: { state: "idle", match: null, queuePosition: null },
        });
    };
    try {
        const result = await settleAndLeaveTowerPvp("tpvp-cccccccccccccccccccccccccccccccc", "Hero");
        assert.equal(result.settled, true);
        const leaves = calls.filter(call => call.url.endsWith("/pvp-queue"));
        assert.equal(leaves.length, 2);
        assert.equal(leaves[0]?.body.action, "leave");
        assert.equal(leaves[0]?.body.matchId, "tpvp-cccccccccccccccccccccccccccccccc");
        assert.equal(leaves[0]?.body.expectedVersion, 11);
        assert.equal(leaves[0]?.body.requestId, leaves[1]?.body.requestId);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
