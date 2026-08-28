/** Exact lane fallback when a Showdown fighter has no field opponent assigned. */
export function showdownLaneFacing(side: "player" | "enemy"): [number, number] {
    return side === "player" ? [0, -1] : [0, 1];
}

/** Horizontal lane occupied by a field slot. Enemy order is mirrored on stage,
 * so equal array indexes are on opposite sides of the screen in a multi-pet
 * fight. Keeping that mirror here and in the renderer prevents facing from
 * silently drifting away from the actual formation. */
export function showdownSlotLane(
    index: number,
    count: number,
    side: "player" | "enemy",
): number {
    return (index - (count - 1) / 2) * (side === "player" ? 1 : -1);
}

/** Pair resting fighters by their physical battlefield lane. In a 2v2 this is
 * left-to-left and right-to-right; raw array-index pairing would cross both
 * sightlines because the enemy formation is mirrored. If one line is shorter,
 * the nearest opposing lane becomes the shared focus. */
export function pairedShowdownOpponentId(
    fighterId: string,
    ownField: readonly string[],
    opposingField: readonly string[],
    side: "player" | "enemy",
): string | null {
    if (opposingField.length === 0) return null;
    const ownIndex = ownField.indexOf(fighterId);
    if (ownIndex < 0) return opposingField[0] ?? null;

    // Full formations have one unambiguous reciprocal assignment. Spell it
    // out instead of relying on nearest-lane tie behaviour: 3v3 is the case
    // that exposed this after 2v2 was corrected, and enemy render order is the
    // exact mirror of player order.
    if (ownField.length === opposingField.length) {
        return opposingField[opposingField.length - 1 - ownIndex] ?? opposingField[0] ?? null;
    }

    const ownLane = showdownSlotLane(ownIndex, ownField.length, side);
    const opposingSide = side === "player" ? "enemy" : "player";
    let pairedIndex = 0;
    let nearestLane = Number.POSITIVE_INFINITY;
    let pairedLane = showdownSlotLane(0, opposingField.length, opposingSide);
    for (let i = 0; i < opposingField.length; i += 1) {
        const candidateLane = showdownSlotLane(i, opposingField.length, opposingSide);
        const laneDistance = Math.abs(candidateLane - ownLane);
        // With uneven teams an outer slot can be exactly between a centre and
        // outer opposing slot. Prefer the outer one so the surviving lanes stay
        // reciprocal instead of pulling an edge fighter across the formation.
        if (laneDistance < nearestLane || (laneDistance === nearestLane && Math.abs(candidateLane) > Math.abs(pairedLane))) {
            nearestLane = laneDistance;
            pairedIndex = i;
            pairedLane = candidateLane;
        }
    }
    return opposingField[pairedIndex] ?? opposingField[0] ?? null;
}
