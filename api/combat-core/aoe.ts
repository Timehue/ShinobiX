import { hexDistance } from './grid.js';

function clampRadius(radius: number): number {
    return Math.max(0, Math.floor(Number(radius) || 0));
}

export function spiralTiles(center: number, radius: number, width: number, height: number): number[] {
    const boundedRadius = clampRadius(radius);
    const tiles: number[] = [];
    if (boundedRadius === 0) return tiles;
    for (let tile = 0; tile < width * height; tile += 1) {
        const distance = hexDistance(center, tile, width);
        if (distance > 0 && distance <= boundedRadius) tiles.push(tile);
    }
    return tiles;
}

export function ringTiles(center: number, radius: number, width: number, height: number): number[] {
    const boundedRadius = clampRadius(radius);
    if (boundedRadius === 0) return [center];
    const tiles: number[] = [];
    for (let tile = 0; tile < width * height; tile += 1) {
        if (hexDistance(center, tile, width) === boundedRadius) tiles.push(tile);
    }
    return tiles;
}

export function filledDiskTiles(center: number, radius: number, width: number, height: number): number[] {
    const boundedRadius = clampRadius(radius);
    const tiles: number[] = [];
    for (let tile = 0; tile < width * height; tile += 1) {
        if (hexDistance(center, tile, width) <= boundedRadius) tiles.push(tile);
    }
    return tiles;
}
