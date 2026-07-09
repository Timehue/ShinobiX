import { test } from "node:test";
import assert from "node:assert/strict";
import { findHollowGatePath, hollowGateKnownSet } from "./hollow-gate-path";
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";

// Tiny hand-built floor: one 5×5 room split by a wall spur, so paths must
// route around it. Row-major, 7 wide × 5 tall, walls on the rim.
//
//   #######
//   #P..s.#     P = player (1,1)   s = a revealed side cell
//   #.###.#
//   #.#d#.#     d = a DISGUISED unresolved trap (revealed room cell)
//   #######
function makeRun(): HollowGateShrineRun {
    const w = 7, h = 5;
    const rows = [
        "#######",
        "#.....#",
        "#.###.#",
        "#.#.#.#",
        "#######",
    ];
    const tiles: HollowGateTile[] = [];
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const wall = rows[y][x] === "#";
            tiles.push({
                kind: wall ? "wall" : "empty",
                terrain: wall ? "wall" : "room_floor",
                roomId: wall ? null : 0,
                revealed: !wall,      // the whole room has been explored
                resolved: !wall,
            });
        }
    }
    return {
        width: w, height: h, playerX: 1, playerY: 1, tiles,
        floor: 1, threat: 0, torch: 10, keys: 0, completed: false,
    };
}

const at = (x: number, y: number, w = 7) => y * w + x;

test("enclosed cells are unreachable (walls block)", () => {
    const run = makeRun();
    assert.equal(findHollowGatePath(run, at(3, 3)), null, "walled-in cell has no path");
});

test("path reaches a far cell the long way around the spur", () => {
    const run = makeRun();
    const path = findHollowGatePath(run, at(5, 3));
    assert.ok(path && path.length > 0, "far cell reachable");
    // Shortest route: (1,1)→(2,1)→(3,1)→(4,1)→(5,1)→(5,2)→(5,3) = 6 steps.
    assert.equal(path.length, 6);
    assert.equal(path[path.length - 1], at(5, 3), "path ends on the target");
    // Every step is cardinal-adjacent to the previous.
    let prev = at(1, 1);
    for (const step of path) {
        const dx = Math.abs((step % 7) - (prev % 7));
        const dy = Math.abs(Math.floor(step / 7) - Math.floor(prev / 7));
        assert.equal(dx + dy, 1, "steps are cardinal-adjacent");
        prev = step;
    }
});

test("unknown (never-revealed) tiles block pathing — no fog leaks", () => {
    const run = makeRun();
    // Hide the right half of the top corridor: (4,1) and (5,1) never seen.
    run.tiles[at(4, 1)].revealed = false;
    run.tiles[at(5, 1)].revealed = false;
    run.tiles[at(5, 2)].revealed = false;
    run.tiles[at(5, 3)].revealed = false;
    // The player stands in the room, so room-flood re-lights the whole room
    // (roomId 0 spans every floor cell here) — split the hidden cells into
    // their own room so visibility does not re-reveal them.
    for (const i of [at(4, 1), at(5, 1), at(5, 2), at(5, 3)]) run.tiles[i].roomId = 1;
    assert.equal(findHollowGatePath(run, at(5, 3)), null, "unknown target is not pathable");
});

test("walking to your own tile is a no-op path", () => {
    const run = makeRun();
    assert.deepEqual(findHollowGatePath(run, at(1, 1)), []);
});

test("knownSet = visible ∪ revealed; diviner knows the whole floor", () => {
    const run = makeRun();
    run.tiles[at(5, 3)].revealed = false;
    run.tiles[at(5, 3)].roomId = 1;      // out of the player's room flood
    const known = hollowGateKnownSet(run);
    assert.ok(!known.has(at(5, 3)), "unseen off-room cell unknown");
    run.diviner = true;
    const divinerKnown = hollowGateKnownSet(run);
    assert.ok(divinerKnown.has(at(5, 3)), "Diviner's Eye knows everything");
});
