import { test } from "node:test";
import assert from "node:assert/strict";
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";
import { projectHollowGateMovement } from "./hollow-gate-movement-projection";

function run(): HollowGateShrineRun {
    const floor: HollowGateTile = { kind: "empty", terrain: "room_floor", roomId: 0, revealed: true, resolved: true };
    const wall: HollowGateTile = { kind: "wall", terrain: "wall", roomId: null, revealed: true, resolved: true };
    return {
        width: 4, height: 2, playerX: 1, playerY: 0,
        tiles: [wall, floor, floor, { ...floor, resolved: false }, wall, wall, wall, wall],
        floor: 1, threat: 0, torch: 10, keys: 0, completed: false,
    };
}

test("movement projection chains rapid steps and emits each tile event once", () => {
    const start = run();
    const first = projectHollowGateMovement(start, 1, 0);
    assert.ok(first);
    assert.equal(first.nextRun.playerX, 2);
    assert.deepEqual(first.effect.step && [first.effect.step.fromX, first.effect.step.toX], [1, 2]);
    assert.equal(first.effect.justResolved, null);
    const second = projectHollowGateMovement(first.nextRun, 1, 0);
    assert.ok(second);
    assert.equal(second.nextRun.playerX, 3);
    assert.deepEqual(second.effect.step && [second.effect.step.fromX, second.effect.step.toX], [2, 3]);
    assert.equal(second.effect.justResolved?.nx, 3);
    assert.equal(start.playerX, 1, "the source run stays unchanged");
});

test("walls and bounds do not commit movement or a server step", () => {
    const start = run();
    assert.equal(projectHollowGateMovement(start, 0, -1), null);
    const blocked = projectHollowGateMovement(start, -1, 0);
    assert.ok(blocked);
    assert.equal(blocked.nextRun, start);
    assert.equal(blocked.effect.wallBump, true);
    assert.equal(blocked.effect.step, undefined);
});
