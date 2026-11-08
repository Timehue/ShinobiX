/** Client copy of each standing road-place building's map sprite:
 * [sector, sprite, top-left tile, tiles per side]. Its tiles are solid in the walk
 * mask, so the floor paints it from this table and never waits on a counter
 * request. The full registry (shared/sector-buildings.ts) stays off the client
 * bundle; a test pins these to each building's `structure`. */
export const STANDING_STRUCTURE_ART: readonly (readonly [number, string, number, number])[] = [
    [3, 'flower-pickers-shelter-map', 101, 2],
];
