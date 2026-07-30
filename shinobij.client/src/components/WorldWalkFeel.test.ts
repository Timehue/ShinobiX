import test from "node:test";
import assert from "node:assert/strict";
import { regionTintForSector, walkingRoute } from "./WorldWalkFeel";
import { SECTOR_ROAD_PAIRS } from "../../../shared/sector-links";

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

test("every region resolves a gate tint", () => {
    for (const sector of [1, 9, 17, 26, 34, 36, 46, 52, 55, 58, 99]) {
        assert.match(regionTintForSector(sector), /^#[0-9a-f]{6}$/i);
    }
});
