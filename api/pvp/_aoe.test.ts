import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spiralTiles, ringTiles, filledDiskTiles, hexDistance } from './_aoe.js';

// Our PvP grid (matches api/pvp/move.ts GRID_W/GRID_H).
const W = 12, H = 10;
// An interior tile whose radius-3 disk fits entirely inside the 12×10 grid.
const CENTER = 5 * W + 6; // (x=6, y=5)

describe('spiralTiles — AOE_SPIRAL_SHOOT (filled disk minus caster)', () => {
    it('matches the reference honeycomb spiral counts 3·R·(R+1) for an unclipped disk', () => {
        assert.equal(spiralTiles(CENTER, 1, W, H).length, 6);   // 3·1·2
        assert.equal(spiralTiles(CENTER, 2, W, H).length, 18);  // 3·2·3
        assert.equal(spiralTiles(CENTER, 3, W, H).length, 36);  // 3·3·4
    });
    it('always excludes the caster tile and only covers 0 < dist <= radius', () => {
        for (const r of [1, 2, 3]) {
            const tiles = spiralTiles(CENTER, r, W, H);
            assert.ok(!tiles.includes(CENTER), 'must exclude the caster tile');
            for (const t of tiles) {
                const d = hexDistance(CENTER, t, W);
                assert.ok(d > 0 && d <= r, `tile ${t} at dist ${d} outside (0, ${r}]`);
            }
        }
    });
    it('radius 1 is exactly the six immediate neighbours', () => {
        const tiles = spiralTiles(CENTER, 1, W, H);
        assert.equal(tiles.length, 6);
        assert.ok(tiles.every((t) => hexDistance(CENTER, t, W) === 1));
    });
    it('radius 0 affects nothing', () => {
        assert.deepEqual(spiralTiles(CENTER, 0, W, H), []);
    });
    it('returns ascending, in-bounds indices (deterministic)', () => {
        const tiles = spiralTiles(CENTER, 2, W, H);
        const sorted = [...tiles].sort((a, b) => a - b);
        assert.deepEqual(tiles, sorted);
        assert.ok(tiles.every((t) => t >= 0 && t < W * H));
    });
    it('clips to the grid at a corner (fewer tiles, all valid)', () => {
        const corner = 0; // (x=0, y=0)
        const tiles = spiralTiles(corner, 2, W, H);
        assert.ok(tiles.length > 0 && tiles.length < 18, 'corner disk is clipped');
        for (const t of tiles) {
            const d = hexDistance(corner, t, W);
            assert.ok(t >= 0 && t < W * H && d > 0 && d <= 2);
        }
    });
});

describe('ringTiles — AOE_CIRCLE_SHOOT (perimeter only)', () => {
    it('matches honeycomb ring counts 6·R for an unclipped ring', () => {
        assert.equal(ringTiles(CENTER, 1, W, H).length, 6);
        assert.equal(ringTiles(CENTER, 2, W, H).length, 12);
    });
    it('every ring tile sits at exactly the radius', () => {
        for (const r of [1, 2, 3]) {
            for (const t of ringTiles(CENTER, r, W, H)) {
                assert.equal(hexDistance(CENTER, t, W), r);
            }
        }
    });
});

describe('filledDiskTiles — AOE_CIRCLE_SPAWN (disk incl. centre)', () => {
    it('matches honeycomb spiral counts 1 + 3·R·(R+1)', () => {
        assert.equal(filledDiskTiles(CENTER, 1, W, H).length, 7);
        assert.equal(filledDiskTiles(CENTER, 2, W, H).length, 19);
    });
    it('is the spiral plus the centre tile', () => {
        const disk = filledDiskTiles(CENTER, 2, W, H);
        const spiral = spiralTiles(CENTER, 2, W, H);
        assert.ok(disk.includes(CENTER));
        assert.deepEqual(disk.filter((t) => t !== CENTER).sort((a, b) => a - b), [...spiral].sort((a, b) => a - b));
    });
});
