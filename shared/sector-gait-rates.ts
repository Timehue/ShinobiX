// The authored animation moves across twelve tiles on a 1,080 pixel map.
export const sectorGaitTilesPerSecond = {walk:31/90,run:120/90} as const;

/**
 * How much faster than the authored clip a PLAYER plays each gait. The clip
 * clock runs this many times faster, so the feet stay locked to the ground and
 * only the cadence rises. NPCs keep the authored stroll (sectorGaitTilesPerSecond).
 * Both rates stay well under the server's 6.5 tiles/s movement cap.
 */
export const playerGaitPace = {walk:3,run:2.5} as const;
export const playerGaitTilesPerSecond = {
    walk: sectorGaitTilesPerSecond.walk * playerGaitPace.walk,
    run: sectorGaitTilesPerSecond.run * playerGaitPace.run,
} as const;
