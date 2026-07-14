import type { JutsuMethod } from "../types/core";

/** Build the aiming footprint for every area-method jutsu. */
export function jutsuImpactPreviewTiles(
    method: JutsuMethod,
    center: number,
    allTiles: readonly number[],
    distance: (a: number, b: number) => number,
    neighbors: (center: number) => number[],
    /** Ground/movement AOE_CIRCLE is a ring; direct-target variants include the target. */
    circleIncludesCenter = false,
): Set<number> {
    if (center < 0) return new Set<number>();

    if (method === "AOE_SPIRAL") {
        return new Set(allTiles.filter((tile) => distance(center, tile) <= 2));
    }

    if (method === "AOE_CIRCLE") {
        return new Set(circleIncludesCenter ? [center, ...neighbors(center)] : neighbors(center));
    }

    if (method === "INSTANT_EFFECT" || method === "AOE_BURST") {
        return new Set([center, ...neighbors(center)]);
    }

    return new Set<number>();
}
