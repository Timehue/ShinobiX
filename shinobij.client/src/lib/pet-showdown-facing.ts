/** Exact lane fallback when a Showdown fighter has no field opponent assigned. */
export function showdownLaneFacing(side: "player" | "enemy"): [number, number] {
    return side === "player" ? [0, -1] : [0, 1];
}

/** Pair field slots by index so resting fighters look at one another instead of
 * at a camera-biased generic angle. If one line is shorter, its last living slot
 * becomes the shared focus rather than leaving an unpaired fighter looking away. */
export function pairedShowdownOpponentId(
    fighterId: string,
    ownField: readonly string[],
    opposingField: readonly string[],
): string | null {
    if (opposingField.length === 0) return null;
    const ownIndex = ownField.indexOf(fighterId);
    const pairedIndex = ownIndex < 0 ? 0 : Math.min(ownIndex, opposingField.length - 1);
    return opposingField[pairedIndex] ?? opposingField[0] ?? null;
}
