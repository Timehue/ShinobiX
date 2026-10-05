/** A quiet, clock-driven walk for service and story wanderers.
 *
 * The route is tied to the actor and its home tile, while the phase follows the
 * server clock. Remounting the sector therefore does not reset everyone to the
 * same starting pose. The short route stays in the board interior and returns
 * to its home tile, so authored encounter placement remains recognizable.
 */
const GRID = 12;
const TILES_PER_SECOND = 0.8;
const PAUSE_SECONDS = 2.5;

type Point = Readonly<{ col: number; row: number }>;
export type LoiterPosition = Point & Readonly<{ walking: boolean; facing: -1 | 1 }>;

function hashId(id: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}

const clampInterior = (n: number) => Math.max(1, Math.min(10, n));

function routeFor(id: string, homeTile: number): readonly Point[] {
    const hash = hashId(id);
    const home = { col: homeTile % GRID, row: Math.floor(homeTile / GRID) };
    const horizontal = (hash & 1) === 0 ? 1 : -1;
    const vertical = (hash & 2) === 0 ? 1 : -1;
    const first = (hash & 4) === 0
        ? { col: clampInterior(home.col + horizontal * 2), row: home.row }
        : { col: home.col, row: clampInterior(home.row + vertical * 2) };
    const second = (hash & 4) === 0
        ? { col: first.col, row: clampInterior(first.row + vertical * 2) }
        : { col: clampInterior(first.col + horizontal * 2), row: first.row };
    return [home, first, second, home];
}

/** Position at an absolute time; consecutive calls and sector remounts agree. */
export function loiterPositionAt(id: string, homeTile: number, nowMs: number): LoiterPosition {
    const route = routeFor(id, homeTile);
    const legs = route.slice(1).map((target, index) => {
        const start = route[index];
        return { start, target, travel: Math.hypot(target.col - start.col, target.row - start.row) / TILES_PER_SECOND };
    });
    const cycle = legs.reduce((sum, leg) => sum + PAUSE_SECONDS + leg.travel, 0);
    const offset = hashId(id) % Math.max(1, Math.floor(cycle * 1000));
    let phase = (((nowMs + offset) / 1000) % cycle + cycle) % cycle;

    for (const leg of legs) {
        if (phase < PAUSE_SECONDS) {
            return { ...leg.start, walking: false, facing: leg.target.col < leg.start.col ? -1 : 1 };
        }
        phase -= PAUSE_SECONDS;
        if (phase < leg.travel) {
            const fraction = leg.travel === 0 ? 1 : phase / leg.travel;
            return {
                col: leg.start.col + (leg.target.col - leg.start.col) * fraction,
                row: leg.start.row + (leg.target.row - leg.start.row) * fraction,
                walking: true,
                facing: leg.target.col < leg.start.col ? -1 : 1,
            };
        }
        phase -= leg.travel;
    }
    return { ...route[0], walking: false, facing: 1 };
}
