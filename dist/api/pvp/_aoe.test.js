"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _aoe_js_1 = require("./_aoe.js");
// Our PvP grid (matches api/pvp/move.ts GRID_W/GRID_H).
const W = 12, H = 10;
// An interior tile whose radius-3 disk fits entirely inside the 12×10 grid.
const CENTER = 5 * W + 6; // (x=6, y=5)
(0, node_test_1.describe)('spiralTiles — AOE_SPIRAL_SHOOT (filled disk minus caster)', () => {
    (0, node_test_1.it)('matches the reference honeycomb spiral counts 3·R·(R+1) for an unclipped disk', () => {
        node_assert_1.strict.equal((0, _aoe_js_1.spiralTiles)(CENTER, 1, W, H).length, 6); // 3·1·2
        node_assert_1.strict.equal((0, _aoe_js_1.spiralTiles)(CENTER, 2, W, H).length, 18); // 3·2·3
        node_assert_1.strict.equal((0, _aoe_js_1.spiralTiles)(CENTER, 3, W, H).length, 36); // 3·3·4
    });
    (0, node_test_1.it)('always excludes the caster tile and only covers 0 < dist <= radius', () => {
        for (const r of [1, 2, 3]) {
            const tiles = (0, _aoe_js_1.spiralTiles)(CENTER, r, W, H);
            node_assert_1.strict.ok(!tiles.includes(CENTER), 'must exclude the caster tile');
            for (const t of tiles) {
                const d = (0, _aoe_js_1.hexDistance)(CENTER, t, W);
                node_assert_1.strict.ok(d > 0 && d <= r, `tile ${t} at dist ${d} outside (0, ${r}]`);
            }
        }
    });
    (0, node_test_1.it)('radius 1 is exactly the six immediate neighbours', () => {
        const tiles = (0, _aoe_js_1.spiralTiles)(CENTER, 1, W, H);
        node_assert_1.strict.equal(tiles.length, 6);
        node_assert_1.strict.ok(tiles.every((t) => (0, _aoe_js_1.hexDistance)(CENTER, t, W) === 1));
    });
    (0, node_test_1.it)('radius 0 affects nothing', () => {
        node_assert_1.strict.deepEqual((0, _aoe_js_1.spiralTiles)(CENTER, 0, W, H), []);
    });
    (0, node_test_1.it)('returns ascending, in-bounds indices (deterministic)', () => {
        const tiles = (0, _aoe_js_1.spiralTiles)(CENTER, 2, W, H);
        const sorted = [...tiles].sort((a, b) => a - b);
        node_assert_1.strict.deepEqual(tiles, sorted);
        node_assert_1.strict.ok(tiles.every((t) => t >= 0 && t < W * H));
    });
    (0, node_test_1.it)('clips to the grid at a corner (fewer tiles, all valid)', () => {
        const corner = 0; // (x=0, y=0)
        const tiles = (0, _aoe_js_1.spiralTiles)(corner, 2, W, H);
        node_assert_1.strict.ok(tiles.length > 0 && tiles.length < 18, 'corner disk is clipped');
        for (const t of tiles) {
            const d = (0, _aoe_js_1.hexDistance)(corner, t, W);
            node_assert_1.strict.ok(t >= 0 && t < W * H && d > 0 && d <= 2);
        }
    });
});
(0, node_test_1.describe)('ringTiles — AOE_CIRCLE_SHOOT (perimeter only)', () => {
    (0, node_test_1.it)('matches honeycomb ring counts 6·R for an unclipped ring', () => {
        node_assert_1.strict.equal((0, _aoe_js_1.ringTiles)(CENTER, 1, W, H).length, 6);
        node_assert_1.strict.equal((0, _aoe_js_1.ringTiles)(CENTER, 2, W, H).length, 12);
    });
    (0, node_test_1.it)('every ring tile sits at exactly the radius', () => {
        for (const r of [1, 2, 3]) {
            for (const t of (0, _aoe_js_1.ringTiles)(CENTER, r, W, H)) {
                node_assert_1.strict.equal((0, _aoe_js_1.hexDistance)(CENTER, t, W), r);
            }
        }
    });
});
(0, node_test_1.describe)('filledDiskTiles — AOE_CIRCLE_SPAWN (disk incl. centre)', () => {
    (0, node_test_1.it)('matches honeycomb spiral counts 1 + 3·R·(R+1)', () => {
        node_assert_1.strict.equal((0, _aoe_js_1.filledDiskTiles)(CENTER, 1, W, H).length, 7);
        node_assert_1.strict.equal((0, _aoe_js_1.filledDiskTiles)(CENTER, 2, W, H).length, 19);
    });
    (0, node_test_1.it)('is the spiral plus the centre tile', () => {
        const disk = (0, _aoe_js_1.filledDiskTiles)(CENTER, 2, W, H);
        const spiral = (0, _aoe_js_1.spiralTiles)(CENTER, 2, W, H);
        node_assert_1.strict.ok(disk.includes(CENTER));
        node_assert_1.strict.deepEqual(disk.filter((t) => t !== CENTER).sort((a, b) => a - b), [...spiral].sort((a, b) => a - b));
    });
});
