import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHollowGateMazeRun } from "./hollow-gate-maze";
import { hollowGateReachableSet } from "./hollow-gate-bsp";

test("maze floor: connected, has spawn/exit/descend, fully reachable", () => {
    // Content is rolled; run several. generateHollowGateMazeRun throws on a
    // reachability failure, which would fail this test rather than ship a bad floor.
    for (let i = 0; i < 25; i += 1) {
        const r = generateHollowGateMazeRun((i % 5) + 1, false);
        const w = r.width, h = r.height;
        const spawnIdx = r.playerY * w + r.playerX;
        const exitIdx = r.tiles.findIndex((t) => t.kind === "exit");
        const descIdx = r.tiles.findIndex((t) => t.kind === "descend");
        assert.ok(exitIdx >= 0 && descIdx >= 0, "has a Leave tile and a descent");
        assert.equal(r.wingThemes, undefined, "maze is not a wing floor");

        const walls = new Set<number>();
        r.tiles.forEach((t, idx) => { if (t.terrain === "wall") walls.add(idx); });
        const reach = hollowGateReachableSet(w, h, spawnIdx, walls);
        assert.ok(reach.has(exitIdx) && reach.has(descIdx), "exit + descent reachable from spawn");

        assert.ok(r.tiles.some((t) => t.terrain === "corridor_floor"), "has maze corridors");
        assert.ok(r.tiles.some((t) => t.terrain === "room_floor"), "has at least one room");
        assert.equal(r.tiles[spawnIdx].kind, "empty"); // spawn cell is clear
    }
});

test("maze final floor: Warden boss, no descend", () => {
    const r = generateHollowGateMazeRun(5, true);
    assert.ok(r.tiles.some((t) => t.kind === "boss"), "final floor has a boss");
    assert.equal(r.tiles.findIndex((t) => t.kind === "descend"), -1, "no descend on final floor");
});
