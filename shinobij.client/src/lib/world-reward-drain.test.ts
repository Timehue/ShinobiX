import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { drainPendingWorldRewardOperations, type WorldRewardDrainCallbacks } from "./world-reward-drain";
import {
    beginExternalWorldExplore,
    beginResolvedWorldExplore,
    beginWorldChestOperation,
    beginWorldDiscoveryOperation,
    completeWorldRewardOperation,
    readPendingWorldRewards,
} from "./world-reward-recovery";

function callbacks(overrides: Partial<WorldRewardDrainCallbacks>): WorldRewardDrainCallbacks {
    const unexpected = (): never => { throw new Error("Unexpected recovery callback"); };
    return {
        continueWorldDiscovery: unexpected,
        recoverPendingExternalDiscovery: unexpected,
        launchResolvedExploreBattle: unexpected,
        recordMissionExplore: unexpected,
        settleDiscoveredChest: unexpected,
        onDungeonFound: unexpected,
        onVersionedCharacter: unexpected,
        ...overrides,
    };
}

async function withReply(data: Record<string, unknown>, run: (requests: Record<string, unknown>[]) => Promise<void>, status = 200) {
    const originalFetch = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try { await run(requests); } finally { globalThis.fetch = originalFetch; }
}

test("recovered pet outcomes revalidate authority before presentation and stop the queue", async () => {
    const player = "drainpet";
    const operation = beginExternalWorldExplore(player, 41, { kind: "pet", token: "sealedtoken" }, undefined, null, "drainpetreceipt01");
    const later = beginResolvedWorldExplore(player, 42, null, "drainpetreceipt02");
    const fieldProgress = [{ missionId: "mission", runId: "run", exploreCount: 1, replayed: true }];
    const calls: string[] = [];
    await withReply({ character: { name: player }, _saveVersion: 17, outcome: { kind: "external", source: "pet" }, fieldProgress }, async (requests) => {
        const result = await drainPendingWorldRewardOperations(player, callbacks({
            onVersionedCharacter: (character, version) => {
                assert.equal(character.name, player);
                assert.equal(version, 17);
                calls.push("adopt");
                return true;
            },
            recordMissionExplore: async (sector, id, evidence) => {
                assert.deepEqual([sector, id, evidence], [41, operation.id, fieldProgress]);
                calls.push("mission");
                return true;
            },
            recoverPendingExternalDiscovery: async (pending, source) => {
                assert.deepEqual(pending, operation);
                assert.equal(source, "pet");
                calls.push("revalidate");
                return true;
            },
        }));
        assert.equal(result.state, "recovered");
        assert.deepEqual(calls, ["adopt", "mission", "revalidate"]);
        assert.equal(requests.length, 1, "later discoveries must wait while the recovered pet is presented");
        assert.equal(requests[0].requestId, operation.id);
        assert.deepEqual(requests[0].externalOutcomeProof, operation.externalOutcomeProof);
        assert.deepEqual(readPendingWorldRewards(player).map(({ id }) => id), [operation.id, later.id]);
    });
});

for (const blockedAt of ["save", "mission"] as const) {
    test(`a missing ${blockedAt} acknowledgement retains the receipt and prevents presentation`, async () => {
        const player = `drain${blockedAt}ack`;
        const operation = beginResolvedWorldExplore(player, 41, null, `drain${blockedAt}receipt`);
        let missionCalls = 0;
        await withReply({ character: { name: player }, _saveVersion: 17, outcome: { kind: "chest" } }, async () => {
            const result = await drainPendingWorldRewardOperations(player, callbacks({
                onVersionedCharacter: () => blockedAt !== "save",
                recordMissionExplore: async () => { missionCalls++; return false; },
            }));
            assert.equal(result.state, "blocked");
            assert.equal(missionCalls, blockedAt === "mission" ? 1 : 0);
            assert.deepEqual(readPendingWorldRewards(player).map(({ id }) => id), [operation.id]);
        });
    });
}

test("a discovery refusal retains its exact explanation for the interactive caller", async () => {
    const player = "draindiscovery";
    const operation = beginWorldDiscoveryOperation(player, 41, "pet", null, "draindiscovery01");
    const message = "Daily wild-pet search limit reached.";
    const result = await drainPendingWorldRewardOperations(player, callbacks({
        continueWorldDiscovery: async (pending, interactive, reportFailure) => {
            assert.deepEqual(pending, operation);
            assert.equal(interactive, false);
            reportFailure(message);
            return "blocked";
        },
    }));
    assert.deepEqual(result, { state: "blocked", message });
    assert.equal(readPendingWorldRewards(player)[0]?.id, operation.id);
});

test("a chest settled from its explore receipt is not processed again from the queue snapshot", async () => {
    const player = "drainchest";
    const explore = beginResolvedWorldExplore(player, 41, null, "drainchestexplore");
    const chest = beginWorldChestOperation(player, 41, explore.id, null);
    let settlements = 0;
    await withReply({ character: { name: player }, outcome: { kind: "chest" } }, async (requests) => {
        const result = await drainPendingWorldRewardOperations(player, callbacks({
            onVersionedCharacter: () => true,
            recordMissionExplore: async () => true,
            settleDiscoveredChest: async (operation) => {
                assert.equal(operation.id, explore.id);
                settlements++;
                completeWorldRewardOperation(player, explore.id);
                completeWorldRewardOperation(player, chest.id);
                return "settled";
            },
        }));
        assert.equal(result.state, "recovered");
        assert.equal(settlements, 1);
        assert.equal(requests.length, 1);
        assert.deepEqual(readPendingWorldRewards(player), []);
    });
});

test("a pending battle retires only the refused request and resumes the server's sealed encounter", async () => {
    const player = "drainbattle";
    const refused = beginResolvedWorldExplore(player, 41, null, "drainbattlerefused");
    const launches: unknown[] = [];
    await withReply({ error: "pending-battle-discovery", requestId: "authoritativebattle", sector: 27 }, async () => {
        const result = await drainPendingWorldRewardOperations(player, callbacks({
            launchResolvedExploreBattle: (sector, id) => { launches.push([sector, id]); return true; },
        }));
        assert.equal(result.state, "recovered");
        assert.deepEqual(launches, [[27, "authoritativebattle"]]);
        assert.ok(!readPendingWorldRewards(player).some(({ id }) => id === refused.id));
    }, 409);
});

test("WorldMap coalesces the complete drain and passes its screen callbacks to the extracted helper", () => {
    const screen = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    assert.match(screen, /import \{ drainPendingWorldRewardOperations, type WorldRecoveryResult \} from "\.\.\/lib\/world-reward-drain"/);
    assert.match(screen, /runSingleFlight\(worldRecoveryInFlight\.current, character\.name, drainPendingWorldRewards\)/);
    const wrapper = screen.slice(screen.indexOf("async function drainPendingWorldRewards"), screen.indexOf("\n    useEffect", screen.indexOf("async function drainPendingWorldRewards")));
    assert.match(wrapper, /return drainPendingWorldRewardOperations\(character\.name, \{/);
    for (const callback of ["continueWorldDiscovery", "recoverPendingExternalDiscovery", "launchResolvedExploreBattle", "recordMissionExplore", "settleDiscoveredChest", "onDungeonFound", "onVersionedCharacter"]) {
        assert.ok(wrapper.includes(`${callback},`), `${callback} must remain connected to the screen`);
    }
});
