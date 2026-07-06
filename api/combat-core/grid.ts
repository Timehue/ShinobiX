import { GRID_H, GRID_W } from './constants.js';

export function xy(pos: number, width = GRID_W): { x: number; y: number } {
    return { x: pos % width, y: Math.floor(pos / width) };
}

export function posFromXY(x: number, y: number, width = GRID_W, height = GRID_H): number {
    if (x < 0 || x >= width || y < 0 || y >= height) return -1;
    return y * width + x;
}

export function axial(pos: number, width = GRID_W): { q: number; r: number } {
    const { x, y } = xy(pos, width);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}

export function hexDistance(a: number, b: number, width = GRID_W): number {
    const A = axial(a, width);
    const B = axial(b, width);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}

export function hexNeighbors(pos: number, width = GRID_W, height = GRID_H): number[] {
    const { x, y } = xy(pos, width);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx!, y + dy!, width, height)).filter(n => n >= 0);
}

export function nextStepToward(from: number, to: number, width = GRID_W, height = GRID_H): number {
    return hexNeighbors(from, width, height).sort((a, b) => hexDistance(a, to, width) - hexDistance(b, to, width))[0] ?? from;
}
