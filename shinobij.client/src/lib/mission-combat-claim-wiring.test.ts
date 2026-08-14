import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { queueCombatMissionClaim } from "./mission-combat-claim";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the queue client publishes the exact server run authority", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return {
            ok: true,
            status: 200,
            json: async () => ({ queued: true, _saveVersion: 17, character: { name: "Rill", level: 20, ryo: 100, inventory: [] } }),
        } as Response;
    }) as typeof fetch;
    try {
        const result = await queueCombatMissionClaim("Rill", "combat-c-patrol", "mission-run-17", 1);
        assert.deepEqual(requestBody, { playerName: "Rill", missionId: "combat-c-patrol", runId: "mission-run-17" });
        assert.equal(result.queued, true);
        assert.equal(result.disposition, "accepted");
        assert.equal(result.saveVersion, 17);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("the sealed mission screen parks before sending and removes only after a decision", () => {
    const missions = source("../screens/Missions.tsx");
    const start = missions.indexOf("async function settleAuthoritativeMission");
    const end = missions.indexOf("async function reportMissionFightOutcome", start);
    assert.ok(start >= 0 && end > start);
    const settle = missions.slice(start, end);
    const park = settle.indexOf("enqueueClaim(playerName, missionId, runId)");
    const send = settle.indexOf("queueCombatMissionClaim(playerName, missionId, runId, 1)");
    const retryable = settle.indexOf('data.disposition === "retryable"');
    const remove = settle.indexOf("removeClaim(playerName, missionId, runId)");
    assert.ok(park >= 0 && send > park);
    assert.ok(retryable > send && remove > retryable);
});

test("queued:false remains retryable unless the exact run is definitively invalid", { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ queued: false, reason: "combat-claim-already-pending" }) }) as Response) as typeof fetch;
        const pending = await queueCombatMissionClaim("Rill", "combat-c-patrol", "mission-run-pending", 1);
        assert.equal(pending.disposition, "retryable");

        globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ queued: false, reason: "expired" }) }) as Response) as typeof fetch;
        const expired = await queueCombatMissionClaim("Rill", "combat-c-patrol", "mission-run-expired", 1);
        assert.equal(expired.disposition, "terminal");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("App quarantines the legacy local-Arena claim callback and fences outbox snapshots", () => {
    const app = source("../App.tsx");
    assert.doesNotMatch(app, /settleCombatMissionClaim|onQueueCombatClaim=\{/);
    assert.match(app, /activeName !== snapshot\.playerName\.toLowerCase\(\)/);
    assert.match(app, /snapshot\.character\.name\.toLowerCase\(\)/);
    assert.match(app, /snapshot\.saveVersion < latestSaveVersionRef\.current/);
});
