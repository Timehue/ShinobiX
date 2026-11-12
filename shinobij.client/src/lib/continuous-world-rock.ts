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
    const windows: { tile: number; rank: number }[] = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        const rank = [0, 1, 2].flatMap(dy => [0, 1, 2].map(dx => mask[y + dy]?.[x + dx] === '#' ? 1 : 0)).reduce<number>((a, b) => a + b, 0);
        if (rank > 0) windows.push({ tile: y * 12 + x, rank });
    }
    return windows.sort((a, b) => b.rank - a.rank || a.tile - b.tile).map(w => w.tile);
}

/** Share of opaque pixels that read as molten lava: bright, strongly saturated orange. */
export function moltenShare(rgba: ArrayLike<number>): number {
    let molten = 0, opaque = 0;
    for (let i = 0; i + 3 < rgba.length; i += 4) {
        if (rgba[i + 3]! < 128) continue;
        opaque++;
        const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!, max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (r > 200 && g > 50 && g < 190 && b < 90 && (max - min) / max > .65) molten++;
    }
    return opaque ? molten / opaque : 0;
}

/** Above this the window touches a lava pool. Measured 2026-11-11 on every floor's
 * pick: ember-cracked rock, orange roofs and autumn foliage at most 0.9%; any
 * window reaching into a Cinderhold lava pool or channel 5-35%. */
export const MOLTEN_ROCK_LIMIT = 0.03;
