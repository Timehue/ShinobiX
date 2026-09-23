import type { ServerArenaSession } from "./server-arena-runtime";

type GroundZone = NonNullable<ServerArenaSession["groundEffects"]>[number];

export type GroundZoneTile = { label: string; tone: "poison" | "recoil" | "debuff" };

/** Project every server-owned zone hex onto the board, including overlapping zones. */
export function groundZoneTilesForDisplay(
    effects: readonly GroundZone[] | undefined,
    tileCount: number,
): Map<number, GroundZoneTile> {
    const tiles = new Map<number, GroundZoneTile>();
    for (const effect of effects ?? []) {
        if (effect.rounds <= 0) continue;
        const tone = effect.tags.some(tag => tag.name === "Poison") ? "poison"
            : effect.tags.some(tag => tag.name === "Recoil") ? "recoil"
                : "debuff";
        const description = `${effect.name}, ${effect.rounds} round${effect.rounds === 1 ? "" : "s"} remaining`;
        for (const tile of effect.tiles) {
            if (!Number.isInteger(tile) || tile < 0 || tile >= tileCount) continue;
            const previous = tiles.get(tile);
            tiles.set(tile, { label: previous ? `${previous.label}; ${description}` : description, tone });
        }
    }
    return tiles;
}
