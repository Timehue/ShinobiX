import { SECTOR_GRID_WIDTH as GRID, tileNeighbors as neighbours, walkableInMask as open } from "../../../../shared/sector-walk-mask";
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
    if (!open(mask, to)) return null;
    const parent = new Map<number, number | null>([[from, null]]), queue = [from];
    for (const here of queue) {
        if (here === to) {
            const trail: number[] = [];
            for (let step = to; step !== from; step = parent.get(step)!) trail.push(step);
            return trail.reverse();
        }
        for (const next of neighbours(here)) if (!parent.has(next) && open(mask, next)) { parent.set(next, here); queue.push(next); }
    }
    return null;
}
