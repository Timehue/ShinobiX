/*
 * Battle Towers — client hex-grid geometry.
 *
 * Generalized over an arbitrary server-driven width/height, byte-for-byte mirroring
 * api/towers/_engine.ts (towerNeighbors) + api/pvp/_aoe.ts (hexDistance) so the client's
 * move/range previews agree EXACTLY with server-side validation. Flat-top, odd-q offset
 * hexes. Distinct from lib/hex-path.ts (the PvP 12×10 cosmetic line-draw) — this one is
 * grid-size-agnostic and combat-accurate for the larger tower board.
 */

export function towerXy(pos: number, w: number): { x: number; y: number } {
    return { x: pos % w, y: Math.floor(pos / w) };
}
export function towerPosFromXY(x: number, y: number, w: number, h: number): number {
    if (x < 0 || x >= w || y < 0 || y >= h) return -1;
    return y * w + x;
}
function axial(pos: number, w: number): { q: number; r: number } {
    const { x, y } = towerXy(pos, w);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}
export function towerHexDistance(a: number, b: number, w: number): number {
    const A = axial(a, w), B = axial(b, w);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}
export function towerNeighbors(pos: number, w: number, h: number): number[] {
    const { x, y } = towerXy(pos, w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => towerPosFromXY(x + dx!, y + dy!, w, h)).filter(n => n >= 0);
}
/** All tiles within `range` hexes of `pos` (brute-force, matches the engine's range checks). */
export function towerTilesInRange(pos: number, range: number, w: number, h: number): Set<number> {
    const out = new Set<number>();
    for (let i = 0; i < w * h; i++) if (towerHexDistance(pos, i, w) <= range) out.add(i);
    return out;
}

// ── Pixel layout (mirrors Arena.tsx HEX constants) ───────────────────────────
export const HEX_W = 72;
export const HEX_H = 42;
const X_STEP = HEX_W * 0.75;     // 54
const Y_STEP = HEX_H * 0.92;     // ≈38.6

export function towerHexPixel(pos: number, w: number): { left: number; top: number } {
    const { x, y } = towerXy(pos, w);
    return { left: x * X_STEP, top: y * Y_STEP + (x % 2 === 1 ? HEX_H / 2 : 0) };
}
export function towerLayerSize(w: number, h: number): { width: number; height: number } {
    return { width: (w - 1) * X_STEP + HEX_W, height: (h - 1) * Y_STEP + HEX_H * 1.5 };
}
