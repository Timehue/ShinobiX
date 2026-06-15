// Hex-grid AOE tile math — a faithful port of the reference combat engine's
// area-of-effect methods onto OUR grid representation.
//
// Both engines use the SAME hex convention: a FLAT-orientation grid with an
// odd-column offset, where the axial coordinate is q = column and
// r = row - floor((col - (col & 1)) / 2). The reference computes its AOE tiles
// with the `honeycomb-grid` library (spiral / ring / line); because our grid
// uses the identical coordinate system, those same shapes reduce to a plain
// hex-distance test on our flat `pos = y * width + x` indices — no library
// needed. `hexDistance` here is byte-for-byte the same formula as `distance()`
// in api/pvp/move.ts, so a tile that is "within range" for combat is exactly a
// tile the spiral covers.
//
// Reference method → helper here:
//   AOE_SPIRAL_SHOOT  → spiralTiles      (filled disk around the CASTER, minus
//                                          the caster's own tile)
//   AOE_CIRCLE_SHOOT  → ringTiles        (just the perimeter at exactly radius)
//   AOE_CIRCLE_SPAWN  → filledDiskTiles  (filled disk INCLUDING the centre)

/** Axial (q,r) for a flat, odd-offset grid index. Matches move.ts `axial()`. */
export function axialOf(pos: number, width: number): { q: number; r: number } {
    const x = pos % width;
    const y = Math.floor(pos / width);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}

/** Hex (cube) distance between two grid indices. Identical to move.ts `distance()`. */
export function hexDistance(a: number, b: number, width: number): number {
    const A = axialOf(a, width);
    const B = axialOf(b, width);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}

function clampRadius(radius: number): number {
    return Math.max(0, Math.floor(Number(radius) || 0));
}

/**
 * AOE_SPIRAL_SHOOT — the reference's caster-centred shockwave.
 *
 * honeycomb's `spiral({ start, radius })` yields every hex within `radius` of
 * `start` (the filled disk, including `start`); the reference then filters out
 * the caster's own tile (`tiles.filter(t => t !== a)`). So the affected set is
 * exactly `{ p : 0 < hexDistance(center, p) <= radius }`, clipped to the grid.
 *
 * Tile count for an unclipped disk of radius R is 3·R·(R+1): R=1→6, R=2→18,
 * R=3→36. Order is ascending grid index (deterministic), which is all the
 * combat resolver needs — the reference's spiral *ordering* only mattered for
 * its render, not for membership.
 */
export function spiralTiles(center: number, radius: number, width: number, height: number): number[] {
    const r = clampRadius(radius);
    const out: number[] = [];
    if (r === 0) return out;
    const n = width * height;
    for (let p = 0; p < n; p++) {
        const d = hexDistance(center, p, width);
        if (d > 0 && d <= r) out.push(p);
    }
    return out;
}

/**
 * AOE_CIRCLE_SHOOT — honeycomb `ring({ center, radius })`: only the perimeter
 * hexes at exactly `radius`. Unclipped count is 6·R (R=1→6, R=2→12).
 */
export function ringTiles(center: number, radius: number, width: number, height: number): number[] {
    const r = clampRadius(radius);
    const out: number[] = [];
    if (r === 0) return [center];
    const n = width * height;
    for (let p = 0; p < n; p++) {
        if (hexDistance(center, p, width) === r) out.push(p);
    }
    return out;
}

/**
 * AOE_CIRCLE_SPAWN — honeycomb `spiral({ start, radius })` WITHOUT the caster
 * filter: the filled disk INCLUDING the centre. Unclipped count is 1 + 3·R·(R+1).
 */
export function filledDiskTiles(center: number, radius: number, width: number, height: number): number[] {
    const r = clampRadius(radius);
    const n = width * height;
    const out: number[] = [];
    for (let p = 0; p < n; p++) {
        if (hexDistance(center, p, width) <= r) out.push(p);
    }
    return out;
}
