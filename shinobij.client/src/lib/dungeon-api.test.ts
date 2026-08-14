import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DungeonProbeError, probeFreeDungeonServer } from "./dungeon-api";

test("free-dungeon probes replay one stable id and adopt the sealed sector", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url, init) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify({
            ok: true,
            requestId: "olderprobe123",
            found: false,
            token: "",
            sector: 33,
            character: { name: "Rill", serverFreeDungeonProbesToday: 1 },
            _saveVersion: 19,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const result = await probeFreeDungeonServer("Rill", 61, "newprobe123");
        assert.deepEqual(body, {
            playerName: "Rill", action: "probe-free", sector: 61, requestId: "newprobe123",
        });
        assert.equal(result.requestId, "olderprobe123", "cross-device recovery must rebind to the server receipt");
        assert.equal(result.sector, 33, "the newly clicked sector cannot replace the sealed discovery sector");
        assert.equal(result.found, false);
        assert.equal(result.resolved, false);
        assert.equal(result._saveVersion, 19);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("resolved dungeon receipts retire without resurrecting a spent run", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
        ok: true,
        requestId: "settledprobe123",
        found: true,
        resolved: true,
        token: "spentdungeontoken123",
        sector: 33,
        character: { name: "Rill", activeDungeonRun: null },
        _saveVersion: 20,
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
        const result = await probeFreeDungeonServer("Rill", 61, "settledprobe123");
        assert.equal(result.resolved, true);
        assert.equal(result.found, true);
    } finally {
        globalThis.fetch = realFetch;
    }

    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const continueDiscovery = worldMap.slice(
        worldMap.indexOf("async function continueWorldDiscovery"),
        worldMap.indexOf("async function resolveExplore"),
    );
    const resolved = continueDiscovery.indexOf("if (probe.resolved)");
    const launch = continueDiscovery.indexOf("onDungeonFound(probe.token)");
    assert.ok(resolved >= 0 && launch > resolved);
    assert.match(continueDiscovery.slice(resolved, launch), /return "recovered"/,
        "the terminal replay must return before the stale token can open Dungeon");
});

test("definitive probe conflicts retire while transport failures stay retryable", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => new Response(JSON.stringify({ error: "active-dungeon-conflict" }), {
            status: 409, headers: { "Content-Type": "application/json" },
        })) as typeof fetch;
        await assert.rejects(
            probeFreeDungeonServer("Rill", 41, "probeconflict123"),
            (error) => error instanceof DungeonProbeError && error.retryable === false && error.status === 409,
        );

        globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
        await assert.rejects(
            probeFreeDungeonServer("Rill", 41, "probeoffline123"),
            (error) => error instanceof DungeonProbeError && error.retryable === true,
        );
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("World recovery advances an authoritative cross-device miss into the pet stage", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const recover = worldMap.slice(
        worldMap.indexOf("async function recoverPendingExternalDiscovery"),
        worldMap.indexOf("async function recoverPendingWorldRewards"),
    );
    assert.match(recover, /if \(!probe\.found\)[\s\S]{0,360}probe\.sector, "pet", undefined, probe\.requestId/);
    assert.match(recover, /continueWorldDiscovery\(next, false\)/,
        "an older unresolved miss must continue at its sealed sector/id instead of deadlocking the new device");
});
