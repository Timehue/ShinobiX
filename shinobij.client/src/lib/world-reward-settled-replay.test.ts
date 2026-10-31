import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    beginResolvedWorldExplore,
    beginWorldChestOperation,
    completeWorldRewardOperation,
    mergeServerPendingWorldRewards,
    readPendingWorldRewards,
    rememberSettledWorldDiscovery,
    WORLD_REWARD_RECOVERY_MAX_AGE_MS,
    type WorldRewardRecoveryStorage,
} from "./world-reward-recovery";
import { drainPendingWorldRewardOperations, type WorldRewardDrainCallbacks } from "./world-reward-drain";
import { readSavePreview, writeSavePreview } from "./save-preview";

const CHEST_ID = "26a49bdd-6eaf-47ed-9ce0-998681fbcd0f";
const staleSnapshot = () => [{ kind: "explore", requestId: CHEST_ID, sector: 18, createdAt: Date.now() - 60_000 }];

function storage(): WorldRewardRecoveryStorage & { values: Map<string, string> } {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
    };
}

/** Stand-in for settleDiscoveredChest: the server pays a discovery once, ever. */
function settledChest(playerName: string, memory: WorldRewardRecoveryStorage | null | undefined, paid: string[]) {
    return async (operation: { id: string; sector: number; worldExploreRequestId?: string; kind: string }) => {
        const discovery = operation.kind === "chest" ? operation.worldExploreRequestId! : operation.id;
        if (!paid.includes(discovery)) paid.push(discovery);
        completeWorldRewardOperation(playerName, operation.id, memory ?? undefined);
        completeWorldRewardOperation(playerName, discovery, memory ?? undefined);
        return "settled" as const;
    };
}

function drainCallbacks(settleDiscoveredChest: WorldRewardDrainCallbacks["settleDiscoveredChest"]): WorldRewardDrainCallbacks {
    return {
        continueWorldDiscovery: async () => "recovered",
        recoverPendingExternalDiscovery: async () => true,
        presentExploreAmbush: () => true,
        recordMissionExplore: async () => true,
        settleDiscoveredChest,
        onDungeonFound: () => undefined,
        onVersionedCharacter: () => true,
    };
}

test("a delayed snapshot cannot requeue a chest this device has settled", () => {
    const memory = storage();
    const chest = beginWorldChestOperation("Buster", 18, CHEST_ID, memory);
    completeWorldRewardOperation("Buster", chest.id, memory);
    for (let replay = 0; replay < 3; replay++) {
        assert.deepEqual(mergeServerPendingWorldRewards("Buster", staleSnapshot(), memory), []);
    }
    assert.deepEqual(readPendingWorldRewards("Buster", memory), []);
});

test("the settled record survives a reload and stays per-account", () => {
    const memory = storage();
    rememberSettledWorldDiscovery("Buster", CHEST_ID, memory);
    assert.deepEqual([...memory.values.keys()], ["worldRewardSettled.v1:buster"]);
    assert.deepEqual(mergeServerPendingWorldRewards("BUSTER", staleSnapshot(), memory), []);
    assert.equal(mergeServerPendingWorldRewards("Sora", staleSnapshot(), memory).length, 1);
});

test("an unsettled chest still imports, which keeps a lost-storage recovery alive", () => {
    const memory = storage();
    rememberSettledWorldDiscovery("Buster", CHEST_ID, memory);
    const merged = mergeServerPendingWorldRewards("Buster", [
        ...staleSnapshot(),
        { kind: "explore", requestId: "genuinelyunpaid01", sector: 41, createdAt: Date.now() },
    ], memory);
    assert.deepEqual(merged.map((entry) => entry.id), ["genuinelyunpaid01"]);
});

test("old and capped settled records stop shadowing ids", () => {
    const memory = storage();
    memory.setItem("worldRewardSettled.v1:buster", JSON.stringify([
        { id: CHEST_ID, at: Date.now() - WORLD_REWARD_RECOVERY_MAX_AGE_MS - 1 },
        { id: 7, at: Date.now() },
        null,
    ]));
    assert.equal(mergeServerPendingWorldRewards("Buster", staleSnapshot(), memory).length, 1, "corrupt and expired rows are ignored");
    for (let index = 0; index < 70; index++) rememberSettledWorldDiscovery("Buster", `settledbulk${index}`, memory);
    assert.equal((JSON.parse(memory.getItem("worldRewardSettled.v1:buster")!) as unknown[]).length, 64);
});

test("private-mode storage still fences the stale id for the life of the page", () => {
    const broken: WorldRewardRecoveryStorage = {
        getItem: () => { throw new Error("private mode"); },
        setItem: () => { throw new Error("private mode"); },
        removeItem: () => { throw new Error("private mode"); },
    };
    rememberSettledWorldDiscovery("Private Buster", CHEST_ID, broken);
    assert.deepEqual(mergeServerPendingWorldRewards("Private Buster", staleSnapshot(), broken), []);
});

test("a lost acknowledgment replays once, then a stale snapshot leaves Explore free", async () => {
    // Node has no localStorage, so the default store is the volatile one that the
    // drain itself reads.
    const player = `Drain ${Date.now()}`;
    const paid: string[] = [];
    const callbacks = drainCallbacks(settledChest(player, undefined, paid));
    const parked = beginWorldChestOperation(player, 18, CHEST_ID);
    assert.equal(parked.kind, "chest");
    assert.equal((await drainPendingWorldRewardOperations(player, callbacks)).state, "recovered");
    mergeServerPendingWorldRewards(player, staleSnapshot());
    assert.deepEqual((await drainPendingWorldRewardOperations(player, callbacks)).state, "none", "the click reaches a fresh Explore");
    assert.deepEqual(paid, [CHEST_ID]);
    const fresh = beginResolvedWorldExplore(player, 41);
    assert.notEqual(fresh.id, CHEST_ID, "a genuinely new Explore gets its own request id");
});

test("concurrent stale imports around a drain never process the chest twice", async () => {
    const player = `Concurrent ${Date.now()}`;
    const paid: string[] = [];
    const settle = settledChest(player, undefined, paid);
    let settles = 0;
    const callbacks = drainCallbacks(async (operation) => {
        settles++;
        mergeServerPendingWorldRewards(player, staleSnapshot()); // arrives mid-settlement: local id wins
        return settle(operation);
    });
    beginWorldChestOperation(player, 18, CHEST_ID);
    mergeServerPendingWorldRewards(player, staleSnapshot());
    assert.equal(readPendingWorldRewards(player).length, 2, "explore mirror row and parked chest operation");
    await drainPendingWorldRewardOperations(player, callbacks);
    assert.equal((await drainPendingWorldRewardOperations(player, callbacks)).state, "none");
    assert.deepEqual(readPendingWorldRewards(player), []);
    assert.deepEqual(paid, [CHEST_ID]);
    assert.ok(settles >= 1);
});

const globals = globalThis as { localStorage?: unknown };
beforeEach(() => { delete globals.localStorage; });
afterEach(() => { delete globals.localStorage; });

test("the save preview never carries the pending list across a reload", () => {
    const memory = storage();
    const character = { name: "Buster" };
    writeSavePreview("Buster", { character, pendingWorldRewards: staleSnapshot() }, memory);
    assert.equal(JSON.parse([...memory.values.values()][0]).pendingWorldRewards, undefined);

    // A preview cached by an older build still holds the list.
    memory.values.clear();
    globals.localStorage = memory;
    memory.setItem("ninjav-save-preview-v1:buster", JSON.stringify({ character, pendingWorldRewards: staleSnapshot() }));
    assert.equal(readSavePreview("Buster")?.pendingWorldRewards, undefined);
});
