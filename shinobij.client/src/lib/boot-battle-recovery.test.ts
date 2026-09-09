import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientBattleLock } from "./battle-save";
import { decideBootBattleRecovery } from "./boot-battle-recovery";

function fixture(overrides: Partial<Parameters<typeof decideBootBattleRecovery>[0]> = {}) {
    const reads: string[] = [];
    const inputs: Parameters<typeof decideBootBattleRecovery>[0] = {
        pvpSessionAliveOnServer: false, restoredPvpBattleId: null, hasPendingPetPvp: false,
        bootLock: { kind: "storyBoss", screen: "storyBoss", battleId: "fight" } as ClientBattleLock,
        readRecentlyResolved: () => { reads.push("resolved"); return ""; },
        readStoryKind: () => { reads.push("story"); return undefined; },
        hasResumeState: () => { reads.push("resume"); return true; },
        ...overrides,
    };
    return { inputs, reads, decide: () => decideBootBattleRecovery(inputs) };
}

test("live human PvP wins over pet PvP and a server lock without touching stale storage", () => {
    const f = fixture({ pvpSessionAliveOnServer: true, restoredPvpBattleId: "pvp", hasPendingPetPvp: true });
    assert.equal(f.decide(), "pvp");
    assert.deepEqual(f.reads, []);
});
test("pending pet PvP wins over the lock, but an incomplete human pointer does not", () => {
    const f = fixture({ pvpSessionAliveOnServer: true, hasPendingPetPvp: true });
    assert.equal(f.decide(), "pet-pvp");
    assert.deepEqual(f.reads, []);
});
test("no usable lock falls back to hub restoration without reading battle state", () => {
    for (const bootLock of [null, undefined, { kind: "arena", battleId: "fight" } as ClientBattleLock]) {
        const f = fixture({ bootLock });
        assert.equal(f.decide(), "hub"); assert.deepEqual(f.reads, []);
    }
});
test("tower authority takes precedence over a cached resolution or missing browser state", () => {
    const f = fixture({ bootLock: { kind: "battleTowers", screen: "battleTowers", battleId: "fight" } as ClientBattleLock });
    assert.equal(f.decide(), "towers"); assert.deepEqual(f.reads, []);
});
test("a matching resolution retries clearing the lock without replaying a loss", () => {
    const f = fixture({ readRecentlyResolved: () => "fight", hasResumeState: () => false });
    assert.equal(f.decide(), "resolved"); assert.deepEqual(f.reads, []);
});
for (const [kind, expected] of [["endless", "endless"], ["arena", "arena"]] as const) {
    test(`retired ${kind} combat bypasses browser resume and loss recovery`, () => {
        const f = fixture({ bootLock: { kind, screen: "battleArena", battleId: "fight" } as ClientBattleLock });
        assert.equal(f.decide(), expected); assert.deepEqual(f.reads, ["resolved"]);
    });
}
for (const [kind, expected, count] of [["hollowGateShrine", "shrine", 1], ["dungeonAi", "dungeon", 2], ["triggeredEvent", "story-event", 3], ["academySparring", "story-event", 3], ["unknown", "story-fallback", 3], [undefined, "story-fallback", 3]] as const) {
    test(`legacy story kind ${kind} preserves ordered routing and never revives the local reducer`, () => {
        let storyReads = 0;
        const f = fixture({ bootLock: { kind: "arenaStory", screen: "battleArena", battleId: "fight" } as ClientBattleLock,
            readStoryKind: () => { storyReads++; return kind; } });
        assert.equal(f.decide(), expected); assert.equal(storyReads, count); assert.deepEqual(f.reads, ["resolved"]);
    });
}
test("unresolved current fights distinguish intact resume state from missing state", () => {
    const f = fixture({ readRecentlyResolved: () => "other-fight" });
    assert.equal(f.decide(), "resume"); assert.deepEqual(f.reads, ["resume"]);
    f.inputs.hasResumeState = () => false;
    assert.equal(f.decide(), "missing");
});
