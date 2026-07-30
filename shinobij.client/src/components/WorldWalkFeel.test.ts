import test from "node:test";
import assert from "node:assert/strict";
import { regionTintForSector, walkingRoute, walkInEntryTile, walkInPath } from "./WorldWalkFeel";
import { SECTOR_ROAD_PAIRS, WALK_IN_DEPTH } from "../../../shared/sector-links";

const DIRECTIONS = ["north", "south", "east", "west"] as const;

const linked = new Set(SECTOR_ROAD_PAIRS.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
const adjacent = (a: number, b: number) => linked.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

test("walkingRoute finds a shortest road path with adjacent hops", () => {
    const route = walkingRoute(26, 8);
    assert.ok(route && route.length >= 2, "route exists");
    assert.equal(route![0], 26);
    assert.equal(route![route!.length - 1], 8);
    for (let i = 0; i < route!.length - 1; i++) {
        assert.ok(adjacent(route![i], route![i + 1]), `${route![i]} -> ${route![i + 1]} is a real road`);
    }
    // Direct neighbours route in exactly one hop.
    assert.deepEqual(walkingRoute(26, 33), [26, 33]);
    assert.deepEqual(walkingRoute(26, 26), [26]);
});

test("walkingRoute refuses off-graph endpoints (village, Death's Gate)", () => {
    assert.equal(walkingRoute(0, 26), null);
    assert.equal(walkingRoute(26, 99), null);
    assert.equal(walkingRoute(99, 99), null);
});

test("walkInPath enters from the crossed edge and walks in to the arrival tile", () => {
    // Arrived heading north → entered through the SOUTH edge → the path starts
    // WALK_IN_DEPTH rows below the arrival tile and steps up one row at a time.
    const north = walkInPath(91, "north");
    assert.equal(north.length, WALK_IN_DEPTH + 1);
    assert.equal(north[0], 91 + WALK_IN_DEPTH * 12, "starts on the edge side");
    assert.equal(north.at(-1), 91, "ends on the server's arrival tile");
    for (let i = 0; i < north.length - 1; i++) {
        assert.equal(north[i] - north[i + 1], 12, "each step is exactly one row inward");
    }

    // East/west entries walk along one row and never wrap onto the next.
    const west = walkInPath(91, "west");
    assert.equal(west.at(-1), 91);
    for (const tile of west) assert.equal(Math.floor(tile / 12), Math.floor(91 / 12));
    for (let i = 0; i < west.length - 1; i++) assert.equal(west[i] - west[i + 1], 1);
});

test("walkInPath clamps at the board edge instead of stepping off it", () => {
    assert.deepEqual(walkInPath(143, "north"), [143]); // bottom row, nothing further south
    assert.deepEqual(walkInPath(132, "east"), [132]);  // left column, nothing further left
    // No path, from any tile in any direction, ever leaves the 12x12 board.
    for (const direction of DIRECTIONS) {
        for (let tile = 0; tile < 144; tile++) {
            for (const step of walkInPath(tile, direction)) {
                assert.ok(step >= 0 && step < 144, `${tile} ${direction} → ${step} off board`);
            }
        }
    }
});

test("walkInEntryTile is the first tile of the walk-in path", () => {
    for (const direction of DIRECTIONS) {
        for (const tile of [0, 5, 91, 132, 143]) {
            assert.equal(walkInEntryTile(tile, direction), walkInPath(tile, direction)[0]);
        }
    }
});

test("every region resolves a gate tint", () => {
    for (const sector of [1, 9, 17, 26, 34, 36, 46, 52, 55, 58, 99]) {
        assert.match(regionTintForSector(sector), /^#[0-9a-f]{6}$/i);
    }
});
