import type { ServerArenaSession } from "./server-arena-runtime";

type GroundZone = NonNullable<ServerArenaSession["groundEffects"]>[number];

export type GroundZoneTile = { label: string; tone: "poison" | "recoil" | "debuff" | "sanctuary" };

/** Project every server-owned zone hex onto the board, including overlapping zones. */
export function groundZoneTilesForDisplay(
    effects: readonly GroundZone[] | undefined,
    tileCount: number,
): Map<number, GroundZoneTile> {
    const tiles = new Map<number, GroundZoneTile>();
    for (const effect of effects ?? []) {
        if (effect.rounds <= 0) continue;
        const buffTile = effect.kind === "occupant";
        const tone = buffTile ? "sanctuary"
            : effect.tags.some(tag => tag.name === "Poison") ? "poison"
            : effect.tags.some(tag => tag.name === "Recoil") ? "recoil"
                : "debuff";
        const remaining = `${effect.rounds} round${effect.rounds === 1 ? "" : "s"} remaining`;
        const description = buffTile
            ? `Buff tile: ${effect.tags.map(tag => `${tag.name} ${tag.percent ?? 30}%`).join(", ")}, ${remaining}. Anyone standing here gains it. Cannot be cleared or cleansed`
            : `${effect.name}, ${remaining}. Cannot be cleared or cleansed`;
        for (const tile of effect.tiles) {
            if (!Number.isInteger(tile) || tile < 0 || tile >= tileCount) continue;
            const previous = tiles.get(tile);
            // A buff tile keeps its gold even where an enemy field overlaps it.
            tiles.set(tile, {
                label: previous ? `${previous.label}; ${description}` : description,
                tone: previous?.tone === "sanctuary" ? "sanctuary" : tone,
            });
        }
    }
    return tiles;
}
