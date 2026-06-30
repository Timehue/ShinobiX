import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHollowGateFloor } from "./hollow-gate-generate";
import { hollowGateReachableSet } from "./hollow-gate-bsp";

// The new coherent generator's professional invariants. The headline guarantee the
// legacy BSP generator lacked: FULL connectivity — every walkable (non-wall) tile is
// reachable from spawn, so no content can ever land in an unreachable pocket.

function wallSet(tiles: { terrain?: string }[]): Set<number> {
    const s = new Set<number>();
    tiles.forEach((t, i) => { if (t.terrain === "wall") s.add(i); });
    return s;
}

test("every floor is FULLY connected — all walkable tiles reachable from spawn", () => {
    for (let i = 0; i < 200; i += 1) {
        const floor = (i % 5) + 1;
        const isFinal = floor >= 5;
        const r = generateHollowGateFloor(floor, isFinal);
        const w = r.width, h = r.height;
        const spawn = r.playerY * w + r.playerX;
        const walls = wallSet(r.tiles);
        const reach = hollowGateReachableSet(w, h, spawn, walls);
        let walkable = 0;
        for (let j = 0; j < r.tiles.length; j += 1) if (r.tiles[j].terrain !== "wall") walkable += 1;
        assert.equal(reach.size, walkable, `floor ${floor} iter ${i}: reached ${reach.size} of ${walkable} walkable — a disconnected pocket exists`);
    }
});

test("exit + descend (non-final) present and reachable; final floor has a reachable boss and no descend", () => {
    for (let i = 0; i < 60; i += 1) {
        const nonFinal = generateHollowGateFloor(2, false);
        const w = nonFinal.width;
        const spawn = nonFinal.playerY * w + nonFinal.playerX;
        const reach = hollowGateReachableSet(w, nonFinal.height, spawn, wallSet(nonFinal.tiles));
        const exitIdx = nonFinal.tiles.findIndex((t) => t.kind === "exit");
        const descIdx = nonFinal.tiles.findIndex((t) => t.kind === "descend");
        assert.ok(exitIdx >= 0 && descIdx >= 0, "non-final floor has exit + descend");
        assert.ok(reach.has(exitIdx) && reach.has(descIdx), "exit + descend reachable");

        const fin = generateHollowGateFloor(5, true);
        const bossIdx = fin.tiles.findIndex((t) => t.kind === "boss");
        assert.ok(bossIdx >= 0, "final floor has a boss");
        assert.equal(fin.tiles.findIndex((t) => t.kind === "descend"), -1, "final floor has no descend");
        const finReach = hollowGateReachableSet(fin.width, fin.height, fin.playerY * fin.width + fin.playerX, wallSet(fin.tiles));
        assert.ok(finReach.has(bossIdx), "boss reachable");
    }
});

test("descend sits deep — a meaningful critical path, not next to spawn", () => {
    // Across many floors the descend should average well away from spawn (the
    // deepest-cell rule). Assert it's never adjacent and usually genuinely far.
    let farEnough = 0;
    const N = 60;
    for (let i = 0; i < N; i += 1) {
        const r = generateHollowGateFloor(3, false);
        const w = r.width;
        const sx = r.playerX, sy = r.playerY;
        const d = r.tiles.findIndex((t) => t.kind === "descend");
        const dx = d % w, dy = Math.floor(d / w);
        const manhattan = Math.abs(dx - sx) + Math.abs(dy - sy);
        assert.ok(manhattan >= 3, `descend too close to spawn (${manhattan})`);
        if (manhattan >= 7) farEnough += 1;
    }
    assert.ok(farEnough >= N * 0.5, `descend should usually be far from spawn (${farEnough}/${N} were >=7 apart)`);
});

test("no content tile is ever placed on a wall", () => {
    for (let i = 0; i < 40; i += 1) {
        const r = generateHollowGateFloor((i % 5) + 1, false);
        for (const t of r.tiles) {
            if (t.terrain === "wall") assert.ok(t.kind === "wall", "wall cells carry only the 'wall' kind");
        }
    }
});

test("spawn tile is revealed + resolved and carries no hostile content", () => {
    const r = generateHollowGateFloor(1, false);
    const spawn = r.tiles[r.playerY * r.width + r.playerX];
    assert.equal(spawn.revealed, true);
    assert.equal(spawn.resolved, true);
    assert.ok(spawn.kind === "empty", "spawn is a safe empty tile");
});
