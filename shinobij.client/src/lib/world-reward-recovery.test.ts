import assert from "node:assert/strict";
import test from "node:test";
import {
    beginExternalWorldExplore,
    beginResolvedWorldExplore,
    beginWorldDiscoveryOperation,
    beginWorldChestOperation,
    beginWorldRewardOperation,
    completeWorldRewardOperation,
    readPendingWorldRewards,
    WORLD_REWARD_RECOVERY_MAX_AGE_MS,
    type WorldRewardRecoveryStorage,
} from "./world-reward-recovery";

function storage(): WorldRewardRecoveryStorage & { values: Map<string, string> } {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
    };
}

test("lost-ACK world rewards reuse a stable per-account operation id", () => {
    const memory = storage();
    const first = beginWorldRewardOperation("Rill O'Neil", "explore", 41, "tile", memory);
    const retry = beginWorldRewardOperation("Rill O'Neil", "explore", 41, "tile", memory);
    const chest = beginWorldChestOperation("Rill O'Neil", 41, first.id, memory);
    assert.equal(retry.id, first.id);
    assert.notEqual(chest.id, first.id);
    assert.equal(readPendingWorldRewards("Rill O'Neil", memory).length, 2);
    assert.deepEqual(readPendingWorldRewards("Other", memory), []);
    completeWorldRewardOperation("Rill O'Neil", first.id, memory);
    assert.deepEqual(readPendingWorldRewards("Rill O'Neil", memory).map((entry) => entry.kind), ["chest"]);
});

test("server outcome and external-discovery proof survive retry and reload", () => {
    const memory = storage();
    const rolled = beginResolvedWorldExplore("Rill", 61, memory);
    const rolledRetry = beginResolvedWorldExplore("Rill", 61, memory);
    const pet = beginExternalWorldExplore("Rill", 62, { kind: "pet", token: "petproof123" }, undefined, memory);
    assert.equal(rolledRetry.id, rolled.id);
    assert.equal(readPendingWorldRewards("Rill", memory).find((entry) => entry.id === rolled.id)?.resolveOutcome, true);
    assert.deepEqual(readPendingWorldRewards("Rill", memory).find((entry) => entry.id === pet.id)?.externalOutcomeProof,
        { kind: "pet", token: "petproof123" });
});

test("dungeon and pet probe stages rebind one cross-device server operation id", () => {
    const memory = storage();
    const local = beginWorldDiscoveryOperation("Rill", 61, "dungeon", memory, "localprobe123");
    const authoritative = beginWorldDiscoveryOperation("Rill", 33, "pet", memory, "serverprobe123");
    completeWorldRewardOperation("Rill", local.id, memory);
    const resolved = beginResolvedWorldExplore("Rill", 33, memory, authoritative.id);
    assert.equal(resolved.id, "serverprobe123");
    assert.equal(resolved.sector, 33);
    assert.equal(resolved.discoveryStage, undefined);
    assert.equal(resolved.resolveOutcome, true);
    assert.deepEqual(readPendingWorldRewards("Rill", memory).map((entry) => entry.id), ["serverprobe123"]);
});

test("recovery storage and account fences use the server-canonical player slug", () => {
    const memory = storage();
    const first = beginWorldRewardOperation("Rill O'Neil!", "explore", 41, "tile", memory);
    const hydrated = beginWorldRewardOperation("rilloneil", "explore", 41, "tile", memory);
    assert.equal(hydrated.id, first.id);
    assert.deepEqual([...memory.values.keys()], ["worldRewardRecovery.v1:rilloneil"]);
    assert.equal(readPendingWorldRewards("RILL O'NEIL", memory)[0]?.id, first.id);
});

test("a throwing storage backend still reuses the live operation id", () => {
    const broken: WorldRewardRecoveryStorage = {
        getItem: () => { throw new Error("private mode"); },
        setItem: () => { throw new Error("private mode"); },
        removeItem: () => { throw new Error("private mode"); },
    };
    const first = beginWorldRewardOperation("Private Rill", "explore", 66, "tile", broken);
    const retry = beginWorldRewardOperation("Private Rill", "explore", 66, "tile", broken);
    assert.equal(retry.id, first.id);
    completeWorldRewardOperation("Private Rill", first.id, broken);
    assert.deepEqual(readPendingWorldRewards("Private Rill", broken), []);
});

test("a chest recovery receipt survives beyond one day for the server authority window", () => {
    const memory = storage();
    memory.setItem("worldRewardRecovery.v1:rill", JSON.stringify([{
        id: "chestoperation123",
        playerName: "Rill",
        kind: "chest",
        sector: 41,
        worldExploreRequestId: "exploreproof123",
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
    }]));
    assert.equal(readPendingWorldRewards("Rill", memory).length, 1);
    assert.ok(WORLD_REWARD_RECOVERY_MAX_AGE_MS >= 31 * 24 * 60 * 60 * 1000);
});
