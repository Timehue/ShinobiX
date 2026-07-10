import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHollowGateShrineRun } from "./hollow-gate-dungeon";
import { hollowGateReachableSet } from "./hollow-gate-bsp";
import { HOLLOW_GATE_MAX_FLOOR } from "../constants/game";

// The dungeon generator rolls between hand-authored layouts (~1/3), a maze (~1/3),
// and a BSP floor (~1/3 + the universal fallback for the other two — dungeon.ts
// returns generateHollowGateShrineRunBSP at the end). Every branch must produce a
// CONNECTED floor: the Leave (exit) tile and the descent/boss must be wall-reachable
// from spawn, or a player can be softlocked. Run many floors so each branch — and
// especially the most-used BSP fallback, which had zero coverage — is exercised.
//
// This file is the regression guard the BSP generator never had. It is importable
// only because generateHollowGateShrineRun now reads HOLLOW_GATE_MAX_FLOOR from
// ../constants/game instead of ../App (App drags index.css and crashes the runner).
// Reachability blocks only `terrain === "wall"`, mirroring hollow-gate-maze.test.ts:
// locked doors are openable with keys, so they are not a hard block.

function wallSet(tiles: { terrain?: string }[]): Set<number> {
    const walls = new Set<number>();
    tiles.forEach((t, idx) => { if (t.terrain === "wall") walls.add(idx); });
    return walls;
}

test("dungeon floors: exit + descent reachable from spawn (layout/maze/BSP)", () => {
    const lastNonFinal = Math.max(1, HOLLOW_GATE_MAX_FLOOR - 1);
    for (let i = 0; i < 150; i += 1) {
        const floor = (i % lastNonFinal) + 1; // 1..maxFloor-1 → never the boss floor
        const r = generateHollowGateShrineRun(floor);
        const w = r.width, h = r.height;
        const spawnIdx = r.playerY * w + r.playerX;
        const exitIdx = r.tiles.findIndex((t) => t.kind === "exit");
        const descIdx = r.tiles.findIndex((t) => t.kind === "descend");
        assert.ok(exitIdx >= 0, `floor ${floor} iter ${i}: has a Leave tile`);
        assert.ok(descIdx >= 0, `floor ${floor} iter ${i}: has a descent`);
        const reach = hollowGateReachableSet(w, h, spawnIdx, wallSet(r.tiles));
        assert.ok(reach.has(exitIdx), `floor ${floor} iter ${i}: exit reachable from spawn`);
        assert.ok(reach.has(descIdx), `floor ${floor} iter ${i}: descent reachable from spawn`);
    }
});

test("dungeon final floor: Warden boss reachable, no descent", () => {
    for (let i = 0; i < 50; i += 1) {
        const r = generateHollowGateShrineRun(HOLLOW_GATE_MAX_FLOOR);
        const w = r.width, h = r.height;
        const spawnIdx = r.playerY * w + r.playerX;
        const bossIdx = r.tiles.findIndex((t) => t.kind === "boss");
        assert.ok(bossIdx >= 0, "final floor has a Warden boss");
        assert.equal(r.tiles.findIndex((t) => t.kind === "descend"), -1, "no descent on final floor");
        const reach = hollowGateReachableSet(w, h, spawnIdx, wallSet(r.tiles));
        assert.ok(reach.has(bossIdx), `final floor iter ${i}: boss reachable from spawn`);
    }
});

test("event variants: shorter gates, compact boards, variant stamped through", () => {
    // A 2-floor compact event gate: floor 1 descends, floor 2 is the boss.
    const variant = { id: "event-test", label: "Test Gate", maxFloor: 2, width: 17, height: 13, bossAiId: "boss-x", bossName: "Test Oni" };
    for (let i = 0; i < 60; i += 1) {
        const f1 = generateHollowGateShrineRun(1, variant);
        assert.equal(f1.width, 17, "variant width honored");
        assert.equal(f1.height, 13, "variant height honored");
        assert.deepEqual(f1.variant, variant, "variant stamped on the run (survives save/resume)");
        assert.ok(f1.tiles.some((t) => t.kind === "descend"), "floor 1 of 2 descends");
        assert.equal(f1.tiles.findIndex((t) => t.kind === "boss"), -1, "no boss before the final floor");

        const f2 = generateHollowGateShrineRun(2, variant);
        const spawn = f2.playerY * f2.width + f2.playerX;
        const bossIdx = f2.tiles.findIndex((t) => t.kind === "boss");
        assert.ok(bossIdx >= 0, "variant final floor has the boss");
        assert.equal(f2.tiles.findIndex((t) => t.kind === "descend"), -1, "variant final floor has no descent");
        assert.ok(hollowGateReachableSet(f2.width, f2.height, spawn, wallSet(f2.tiles)).has(bossIdx), "boss reachable");
    }
    // A 1-floor gauntlet is the final floor immediately.
    for (let i = 0; i < 30; i += 1) {
        const solo = generateHollowGateShrineRun(1, { id: "event-solo", maxFloor: 1 });
        assert.ok(solo.tiles.some((t) => t.kind === "boss"), "1-floor gauntlet spawns its boss on floor 1");
        assert.equal(solo.tiles.findIndex((t) => t.kind === "descend"), -1);
        assert.equal(solo.width, 25, "omitted dims → standard board");
    }
    // No variant → identical default behavior (regression guard).
    const std = generateHollowGateShrineRun(1);
    assert.equal(std.variant, undefined, "standard runs carry no variant field");
});
