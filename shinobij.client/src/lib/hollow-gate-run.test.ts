import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun } from "../types/character";
import {
    snapshotHollowGateCurrencies,
    clawBackHollowGateLoot,
    hollowGateClawBackPreview,
    hollowShardDrop,
} from "./hollow-gate-run";

// Minimal fixtures — the helpers only read the clawback currency keys + the
// run's entryCurrencies, so we cast partials rather than build full types.
function char(overrides: Record<string, number>): Character {
    return { ryo: 0, auraDust: 0, auraStones: 0, boneCharms: 0, fateShards: 0, honorSeals: 0, hollowShards: 0, ...overrides } as unknown as Character;
}
function runWith(entry: Record<string, number> | undefined): HollowGateShrineRun {
    return { entryCurrencies: entry } as unknown as HollowGateShrineRun;
}

test("snapshot captures all clawback currencies, defaulting missing to 0", () => {
    const snap = snapshotHollowGateCurrencies(char({ ryo: 500, fateShards: 3 }));
    assert.equal(snap.ryo, 500);
    assert.equal(snap.fateShards, 3);
    assert.equal(snap.boneCharms, 0);
    assert.equal(snap.hollowShards, 0);
});

test("claw-back removes 50% of net gain since entry, floored", () => {
    const entry = { ryo: 1000, boneCharms: 10, hollowShards: 0 };
    // earned this run: +400 ryo, +5 bone charms, +7 shards
    const after = char({ ryo: 1400, boneCharms: 15, hollowShards: 7 });
    const clawed = clawBackHollowGateLoot(after, runWith(entry));
    assert.equal(clawed.ryo, 1400 - 200);          // lose floor(400*0.5)=200
    assert.equal(clawed.boneCharms, 15 - 2);        // lose floor(5*0.5)=2
    assert.equal((clawed as Record<string, number>).hollowShards, 7 - 3); // lose floor(7*0.5)=3
});

test("claw-back never drops a balance below its entry value", () => {
    const entry = { ryo: 1000 };
    const clawed = clawBackHollowGateLoot(char({ ryo: 1001 }), runWith(entry));
    assert.equal(clawed.ryo, 1001); // earned 1 → lose floor(0.5)=0
});

test("claw-back ignores currency spent below entry (no negative)", () => {
    // Player spent shards mid-run: balance is below entry → earned clamps to 0.
    const entry = { hollowShards: 20 };
    const clawed = clawBackHollowGateLoot(char({ hollowShards: 5 }), runWith(entry));
    assert.equal((clawed as Record<string, number>).hollowShards, 5); // nothing clawed
});

test("legacy run with no snapshot claws back nothing", () => {
    const before = char({ ryo: 9999, fateShards: 5 });
    const clawed = clawBackHollowGateLoot(before, runWith(undefined));
    assert.deepEqual(clawed, before);
});

test("preview matches what claw-back would remove", () => {
    const entry = { ryo: 1000, auraStones: 4 };
    const after = char({ ryo: 1500, auraStones: 10 });
    const preview = hollowGateClawBackPreview(after, runWith(entry));
    assert.equal(preview.ryo, 250);        // floor(500*0.5)
    assert.equal(preview.auraStones, 3);   // floor(6*0.5)
});

test("shard drops scale with depth and source", () => {
    assert.equal(hollowShardDrop(1, "chest"), 3);
    assert.equal(hollowShardDrop(5, "chest"), 7);
    assert.equal(hollowShardDrop(1, "lockedChest"), 7);
    assert.equal(hollowShardDrop(5, "lockedChest"), 15);
    assert.equal(hollowShardDrop(5, "boss"), 40);
    // deeper sources always pay at least as much
    assert.ok(hollowShardDrop(3, "lockedChest") > hollowShardDrop(3, "chest"));
});
