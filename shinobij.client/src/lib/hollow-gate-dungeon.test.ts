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
