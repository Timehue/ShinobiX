import { sectorGaitTilesPerSecond } from '../../../../shared/sector-gait-rates';
import { SECTOR_GRID_WIDTH as GRID, tileNeighbors as neighbours, walkableInMask as open, pathInMask, nearestInMask } from "../../../../shared/sector-walk-mask";
export { GRID, neighbours, open };
export const STEP = { ArrowUp: -GRID, ArrowDown: GRID, ArrowLeft: -1, ArrowRight: 1, w: -GRID, s: GRID, a: -1, d: 1 } as Record<string, number>;
export const col = (tile: number) => tile % GRID, row = (tile: number) => Math.floor(tile / GRID);
export const centre = (tile: number) => ({ left: `${(col(tile) + .5) / GRID * 100}%`, top: `${(row(tile) + .5) / GRID * 100}%` });

/** Position a painted site's hit area by its centre on the coast grid. */
export function footprintStyle(x: number, y: number, width: number, height = width) {
    const percent = (cells: number) => cells / GRID * 100 + "%";
    return { left: percent(x + width / 2), top: percent(y + height / 2), width: percent(width), height: percent(height) };
}

/** Shortest walk over open ground, or null when there is none. */
export function pathTo(mask: readonly string[], from: number, to: number): number[] | null {
    return pathInMask(mask, from, to)?.slice(1) ?? null;
}

/** A patrol follows the painted trail. A resident paces a short stretch near their station. */
export function coastRoutine(mask: readonly string[], tile: number, patrol: boolean, speakingTile?: number) {
    const road = patrol ? mask.map(row => row.replaceAll(".", "#")) : mask;
    const start = nearestInMask(road, tile);
    const seen = new Set([start]), paths = [[start]];
    // Count actual footsteps around scenery so a resident stays near their station.
    let path = paths[0];
    for (path of paths) {
        if (path.length > (patrol ? 7 : 2)) break;
        for (const next of neighbours(path.at(-1)!)) {
            if (next === speakingTile || seen.has(next) || !open(road, next)) continue;
            seen.add(next);
            paths.push([...path, next]);
        }
    }
    if (path.length < 2) return;
    const circuit = [...path, ...path.toReversed(), start];
    const step = 1000 / sectorGaitTilesPerSecond.walk;
    return { start: tile * 1000, repeat: (circuit.length - 1) * step,
        frames: circuit.map((at, i) => [i * step, at] as const) };
}
