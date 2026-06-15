// Hex linedraw for movement animation. Given two grid indices on the PvP/arena
// hex board (flat-top, odd-column offset — q = col, r = row - (col - (col&1))/2,
// matching `pvpAxial` in PvpBattleScreen.tsx and `axialOf` in api/pvp/_aoe.ts),
// return the ordered list of hex indices the mover passes through, inclusive of
// both endpoints. Purely cosmetic: it drives the step-by-step travel animation
// so a Move / Dash / Flicker / Push / Pull reads as crossing the grid instead of
// teleporting. It never feeds combat math, so a rounding quirk is harmless.

type Cube = { x: number; y: number; z: number };

/** Odd-q offset grid index → cube coords. */
function offsetToCube(pos: number, width: number): Cube {
    const col = pos % width;
    const row = Math.floor(pos / width);
    const x = col;
    const z = row - ((col - (col & 1)) >> 1);
    return { x, y: -x - z, z };
}

/** Cube coords → odd-q offset grid index, or -1 if outside the board. */
function cubeToOffset(c: Cube, width: number, height: number): number {
    const col = c.x;
    const row = c.z + ((c.x - (c.x & 1)) >> 1);
    if (col < 0 || col >= width || row < 0 || row >= height) return -1;
    return row * width + col;
}

function cubeRound(rx: number, ry: number, rz: number): Cube {
    let x = Math.round(rx);
    let y = Math.round(ry);
    let z = Math.round(rz);
    const dx = Math.abs(x - rx);
    const dy = Math.abs(y - ry);
    const dz = Math.abs(z - rz);
    if (dx > dy && dx > dz) x = -y - z;
    else if (dy > dz) y = -x - z;
    else z = -x - y;
    return { x, y, z };
}

function cubeDistance(a: Cube, b: Cube): number {
    return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;
}

/**
 * Ordered hex tiles from `from` to `to`, inclusive. Returns `[from]` when the
 * endpoints coincide. Out-of-board rounded cells are skipped, and consecutive
 * duplicates are collapsed, so the result is a clean walkable sequence with the
 * real endpoints pinned at the ends.
 */
export function hexLineTiles(from: number, to: number, width: number, height: number): number[] {
    if (from === to || from < 0 || to < 0) return [from];
    const a = offsetToCube(from, width);
    const b = offsetToCube(to, width);
    const n = cubeDistance(a, b);
    if (n === 0) return [from];
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const idx = cubeToOffset(
            cubeRound(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
            width,
            height,
        );
        if (idx >= 0 && (out.length === 0 || out[out.length - 1] !== idx)) out.push(idx);
    }
    if (out.length === 0 || out[0] !== from) out.unshift(from);
    if (out[out.length - 1] !== to) out.push(to);
    return out;
}
