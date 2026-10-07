import type { SectorExit } from '../../../shared/sector-links';

/** Partition overlapping previews at the midpoint between adjacent gate lanes. */
export function gateGlimpseBand(exit: SectorExit, exits: readonly SectorExit[]) {
    const horizontal = exit.direction === 'north' || exit.direction === 'south';
    const laneOf = (road: SectorExit) => horizontal ? road.tile % 12 : Math.floor(road.tile / 12);
    const lane = laneOf(exit);
    const lanes = exits.filter(road => road.direction === exit.direction).map(laneOf).sort((a,b) => a-b);
    const index = lanes.indexOf(lane), previous = lanes[index-1], next = lanes[index+1];
    const start = Math.max(lane-1, previous === undefined ? 0 : (previous+lane+1)/2);
    const end = Math.min(lane+2, next === undefined ? 12 : (next+lane+1)/2);
    return { horizontal, lane, start, end, clipStart: (start-lane+1)/3*100, clipEnd: (lane+2-end)/3*100 };
}
