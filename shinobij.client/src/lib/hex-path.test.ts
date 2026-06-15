/*
 * hexLineTiles drives the movement-travel animation (Move / Dash / Flicker /
 * Push / Pull) on the PvP hex board. These tests pin the two properties the
 * animation relies on: the path is a real walkable chain (each step adjacent to
 * the last) and it starts/ends exactly on the requested cells.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { hexLineTiles } from "./hex-path";

const W = 12;
const H = 10;

// Same flat-top odd-q convention as pvpAxial / api/pvp/_aoe.ts axialOf.
function axial(pos: number) {
    const x = pos % W;
    const y = Math.floor(pos / W);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}
function dist(a: number, b: number): number {
    const A = axial(a);
    const B = axial(b);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}

describe("hexLineTiles", () => {
    it("returns a single cell when the endpoints coincide", () => {
        assert.deepEqual(hexLineTiles(25, 25, W, H), [25]);
    });

    it("pins the real endpoints at the ends", () => {
        const path = hexLineTiles(0, 40, W, H);
        assert.equal(path[0], 0);
        assert.equal(path[path.length - 1], 40);
    });

    it("walks a chain of mutually adjacent hexes (no jumps)", () => {
        // A spread of source→destination pairs across the board.
        const pairs: [number, number][] = [[0, 40], [5, 53], [60, 18], [11, 96], [49, 50], [12, 1]];
        for (const [from, to] of pairs) {
            const path = hexLineTiles(from, to, W, H);
            for (let i = 1; i < path.length; i++) {
                assert.equal(dist(path[i - 1]!, path[i]!), 1, `step ${path[i - 1]}→${path[i]} (line ${from}→${to}) must be adjacent`);
            }
        }
    });

    it("has length = hex distance + 1 (covers every step exactly once)", () => {
        const cases: [number, number][] = [[0, 40], [5, 53], [60, 18], [49, 52]];
        for (const [from, to] of cases) {
            const path = hexLineTiles(from, to, W, H);
            assert.equal(path.length, dist(from, to) + 1, `line ${from}→${to}`);
        }
    });

    it("keeps every tile inside the board bounds", () => {
        const path = hexLineTiles(2, 117, W, H);
        for (const p of path) {
            assert.ok(p >= 0 && p < W * H, `tile ${p} in bounds`);
        }
    });

    it("an adjacent move is just the two cells", () => {
        const path = hexLineTiles(13, 14, W, H);
        assert.deepEqual(path, [13, 14]);
    });
});
