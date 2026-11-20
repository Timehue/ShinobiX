/** Spread occupants of the same courtyard tile while keeping their feet on it. */
export function shrineFigurePositions<T extends { tile: number }>(players: readonly T[], self: T | undefined, stepping?: number | null) {
    const groups = new Map<number, T[]>();
    for (const player of players) {
        const tile = player === self ? stepping ?? player.tile : player.tile;
        const group = groups.get(tile);
        if (group) group.push(player);
        else groups.set(tile, [player]);
    }
    return Array.from(groups).flatMap(([tile, group]) => group.map((player, i) => {
        const offset = group.length > 1 ? (i / (group.length - 1) - 0.5) * 0.55 : 0;
        return { player, left: (tile % 12 + 0.5 + offset) * 100 / 12, top: (Math.floor(tile / 12) + 0.5) * 100 / 12 };
    }));
}
