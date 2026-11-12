/**
 * Which 3x3 window of a sector's floor the walk view cuts out as its biome's rock
 * sprite: the clusters and rims it stamps on closed ground between sectors.
 *
 * The densest blocked (`#`) window wins, in reading order on a tie, exactly as
 * before. But a blocked cell is not always rock: since 2026-11-11 several
 * Cinderhold floors carry lava pools and channels on blocked ground, and the
 * densest window of 67, 70 and 73 is a lava pool. Stamped as "rock", it scattered
 * molten tiles along every volcano corridor. So a window that is mostly molten is
 * passed over for the next densest one.
 */
export function rockWindows(mask: readonly string[]): number[] {
    // One sortable key per window with any blocked cell: rank first, then the
    // lower tile (reading order) on a tie. Windows start in columns 0-9, rows 0-9.
    const keys: number[] = [];
    for (let tile = 0; tile < 118; tile++) {
        if (tile % 12 > 9) continue;
        let rank = 0;
        for (let k = 0; k < 9; k++) if (mask[(tile / 12 | 0) + (k / 3 | 0)]?.[tile % 12 + k % 3] === '#') rank++;
        if (rank) keys.push(rank * 1000 + 999 - tile);
    }
    return keys.sort((a, b) => b - a).map(key => 999 - key % 1000);
}

/**
 * Share of opaque pixels that read as molten lava: bright, strongly saturated
 * orange. Red is the largest channel of any such pixel, so its saturation is
 * (r - min(g, b)) / r.
 */
export function moltenShare(rgba: ArrayLike<number>): number {
    let molten = 0, opaque = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! > 127) {
        opaque++;
        const r = rgba[i - 3]!, g = rgba[i - 2]!, b = rgba[i - 1]!;
        if (r > 200 && g > 50 && g < 190 && b < 90 && r - Math.min(g, b) > .65 * r) molten++;
    }
    return molten / (opaque || 1);
}

/** Above this the window touches a lava pool. Measured 2026-11-11 on every floor's
 * pick: ember-cracked rock, orange roofs and autumn foliage at most 0.9%; any
 * window reaching into a Cinderhold lava pool or channel 5-35%. */
export const MOLTEN_ROCK_LIMIT = 0.03;
