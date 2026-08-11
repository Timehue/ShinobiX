import assert from "node:assert/strict";
import test from "node:test";
import {
    createTowerMoveToken,
    startTowerRun,
    submitTowerAction,
    submitTowerActionWithLostResponseRetry,
    TowerTransportError,
    withTowerRequestDeadline,
    type TowerActionCommandMeta,
    type TowerActionResponse,
    type TowerSession,
} from "./towers-api";

const response: TowerActionResponse = {
    applied: true,
    replayed: true,
    currentVersion: 8,
    session: { actionVersion: 8 } as TowerSession,
};

test("lost Tower action responses retry once with the exact same command token", async () => {
    const commands: TowerActionCommandMeta[] = [];
    const request: typeof submitTowerAction = async (_runId, _playerName, _action, metadata) => {
        assert.ok(metadata);
        commands.push(metadata);
        if (commands.length === 1) throw new TowerTransportError("response lost");
        return response;
    };

    const result = await submitTowerActionWithLostResponseRetry("run-1", "Hero", { type: "wait" }, 7, request);
    assert.equal(result.replayed, true);
    assert.equal(commands.length, 2);
    assert.strictEqual(commands[0], commands[1], "the retry must reuse the original metadata object");
    assert.equal(commands[0]?.expectedVersion, 7);
    assert.match(commands[0]?.moveToken ?? "", /^[A-Za-z0-9_-]{16,80}$/);
});

test("Tower action retries are transport-only and capped at one replay", async () => {
    let calls = 0;
    const rejectedRequest: typeof submitTowerAction = async () => {
        calls += 1;
        throw new Error("HTTP rejection");
    };
    await assert.rejects(
        submitTowerActionWithLostResponseRetry("run-2", "Hero", { type: "wait" }, 3, rejectedRequest),
        /HTTP rejection/,
    );
    assert.equal(calls, 1);
    assert.match(createTowerMoveToken(), /^[A-Za-z0-9_-]{16,80}$/);
});

test("direct Story starts send a host-only contract with no borrowed allies field", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "/api/towers/start");
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify({ runId: "tower-solo", session: { runId: "tower-solo" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    try {
        const result = await startTowerRun("Hero", 4);
        assert.equal(result.runId, "tower-solo");
        assert.deepEqual(requestBody, { hostName: "Hero", floor: 4 });
        assert.equal("allies" in (requestBody ?? {}), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Tower request deadlines abort a hung transport and surface a retryable error", async () => {
    const startedAt = Date.now();
    await assert.rejects(
        withTowerRequestDeadline<never>(signal => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }), undefined, 5),
        (error: unknown) => error instanceof TowerTransportError && /timed out/i.test(error.message),
    );
    assert.ok(Date.now() - startedAt < 1_000, "the deadline must settle instead of leaving the UI busy forever");
});

test("action conflicts adopt the authoritative session instead of trapping a stale local turn", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: "The turn already advanced.",
        errorCode: "stale-version",
        currentVersion: 9,
        session: { actionVersion: 9, activeIndex: 2 },
    }), { status: 409, headers: { "Content-Type": "application/json" } });
    try {
        const result = await submitTowerAction("run-afk", "Hero", { type: "wait" }, { moveToken: "tower_conflict_token", expectedVersion: 8 });
        assert.equal(result.applied, false);
        assert.equal(result.reason, "stale-version");
        assert.equal(result.currentVersion, 9);
        assert.equal(result.session.actionVersion, 9);
        assert.equal(result.session.activeIndex, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
