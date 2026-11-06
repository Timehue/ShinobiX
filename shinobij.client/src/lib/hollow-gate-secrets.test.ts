import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHollowGateShrineRun } from "./hollow-gate-dungeon";
import { hollowGateSecretSealed, sealHollowGateSecretPassage } from "./hollow-gate-secrets";
import { validateHollowGateFloorManifest } from "../../../api/hollow-gate/_floor-manifest";
import type { HollowGateShrineRun } from "../types/character";

const kindCounts = (run: HollowGateShrineRun) => {
    const counts: Record<string, number> = {};
    for (const tile of run.tiles) if (tile.kind !== "wall" && tile.kind !== "empty") counts[tile.kind] = (counts[tile.kind] ?? 0) + 1;
    return counts;
};

function cutOff(run: HollowGateShrineRun, door: number): number[] {
    const w = run.width, start = run.playerY * w + run.playerX;
    const walk = (i: number) => run.tiles[i] && run.tiles[i].kind !== "wall" && run.tiles[i].terrain !== "wall";
    const reach = new Set([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
        const i = queue[head];
        for (const n of [i - w, i + w, i % w ? i - 1 : -1, (i + 1) % w ? i + 1 : -1]) {
            if (n < 0 || n >= run.tiles.length || n === door || reach.has(n) || !walk(n)) continue;
            reach.add(n); queue.push(n);
        }
    }
    return run.tiles.map((_, i) => i).filter((i) => walk(i) && i !== door && !reach.has(i));
}

test("many floors hide one optional area, and the floor's rules are untouched", () => {
    let withSecret = 0;
    for (let n = 0; n < 60; n += 1) {
        const floor = 1 + (n % 5);
        const run = generateHollowGateShrineRun(floor, undefined, `secret-seed-${n}`);
        const secrets = run.tiles.map((t, i) => (t.secret ? i : -1)).filter((i) => i >= 0);
        assert.ok(secrets.length <= 1, "at most one secret per floor");
        // The server's floor seal accepts it, with the same content counts as
        // the floor drawn without a secret (a carved nook only moves a chest).
        const sealed = validateHollowGateFloorManifest({ floor, finalFloor: floor >= 5, width: run.width, height: run.height,
            playerX: run.playerX, playerY: run.playerY, tiles: run.tiles });
        assert.ok(sealed.ok, `floor-seal refused: ${sealed.ok ? "" : sealed.reason}`);
        const plain = generateHollowGateShrineRun(floor, undefined, `secret-seed-${n}`, false, false);
        assert.deepEqual(kindCounts(run), kindCounts(plain), "same chests, fights and rewards");
        assert.equal(plain.tiles.some((t) => t.secret), false, "secrets: false draws the pre-secret floor");
        if (!secrets.length) continue;
        withSecret += 1;
        const door = secrets[0];
        assert.ok(run.tiles[door].terrain === "door" || run.tiles[door].terrain === "corridor_floor");
        assert.equal(run.tiles[door].kind, "empty");
        const hidden = cutOff(run, door);
        assert.ok(hidden.length > 0, "the passage leads somewhere");
        const walkableCount = run.tiles.filter((t) => t.kind !== "wall" && t.terrain !== "wall").length;
        assert.ok(hidden.length <= Math.max(8, Math.floor(walkableCount / 4)), "a side area, not half the floor");
        for (const i of hidden) assert.ok(!["exit", "descend", "boss", "npc"].includes(run.tiles[i].kind), "nothing required is hidden");
        assert.ok(hidden.some((i) => ["shrine", "chest", "shard_vein", "story"].includes(run.tiles[i].kind)), "a reward waits inside");
        assert.equal(hollowGateSecretSealed(run.tiles[door]), true);
        assert.equal(hollowGateSecretSealed({ ...run.tiles[door], revealed: true }), false, "stepping through breaks it open");
    }
    console.log(`secret passages on ${withSecret}/60 sampled floors`);
    assert.ok(withSecret >= 15, `expected many floors to carry a secret, got ${withSecret}/60`);
});

test("the pass is deterministic and idempotent, so recovery redraws the same secret", () => {
    const a = generateHollowGateShrineRun(3, undefined, "secret-determinism");
    const b = generateHollowGateShrineRun(3, undefined, "secret-determinism");
    assert.deepEqual(a.tiles.map((t) => !!t.secret), b.tiles.map((t) => !!t.secret));
    assert.equal(sealHollowGateSecretPassage(a), a, "a second pass changes nothing");
});
