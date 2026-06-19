import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    towerXy, towerPosFromXY, towerHexDistance, towerNeighbors, towerTilesInRange,
    towerHexPixel, towerLayerSize, HEX_W, HEX_H,
} from './tower-grid.js';

describe('Battle Towers client grid geometry', () => {
    it('xy <-> pos round-trips and bounds-checks', () => {
        const w = 20, h = 16;
        for (const pos of [0, 1, 19, 20, 319]) {
            const { x, y } = towerXy(pos, w);
            assert.equal(towerPosFromXY(x, y, w, h), pos);
        }
        assert.equal(towerPosFromXY(-1, 0, w, h), -1);
        assert.equal(towerPosFromXY(20, 0, w, h), -1);
        assert.equal(towerPosFromXY(0, 16, w, h), -1);
    });

    it('hexDistance==1 IFF neighbor membership (adjacency invariant, matches the server)', () => {
        for (const [w, h] of [[20, 16], [12, 10]] as const) {
            for (let a = 0; a < w * h; a++) {
                const nbrs = new Set(towerNeighbors(a, w, h));
                for (let b = 0; b < w * h; b++) {
                    if (a === b) continue;
                    const adjacent = towerHexDistance(a, b, w) === 1;
                    assert.equal(adjacent, nbrs.has(b), `(${a},${b}) on ${w}x${h}`);
                }
            }
        }
    });

    it('tilesInRange includes self + all neighbors at range 1', () => {
        const w = 20, h = 16, pos = 168;
        const r1 = towerTilesInRange(pos, 1, w, h);
        assert.ok(r1.has(pos), 'self is within range 0/1');
        for (const n of towerNeighbors(pos, w, h)) assert.ok(r1.has(n), `neighbor ${n} in range 1`);
        // a range-2 set is strictly larger than range-1
        assert.ok(towerTilesInRange(pos, 2, w, h).size > r1.size);
    });

    it('pixel layout: odd columns are offset down half a hex; layer grows with the grid', () => {
        const w = 20;
        assert.deepEqual(towerHexPixel(0, w), { left: 0, top: 0 });           // even col, no offset
        assert.equal(towerHexPixel(1, w).top, HEX_H / 2);                      // col 1 (odd) offset down
        const small = towerLayerSize(8, 8);
        const big = towerLayerSize(20, 16);
        assert.ok(big.width > small.width && big.height > small.height);
        assert.ok(small.width >= HEX_W);
    });
});
