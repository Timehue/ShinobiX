export type PveGroundZoneOwner = "player" | "enemy";

export type PveGroundZoneTag = {
    name: string;
    percent?: number;
};

export type PveGroundZone = {
    id: string;
    owner: PveGroundZoneOwner;
    tiles: number[];
    rounds: number;
    tags: PveGroundZoneTag[];
};

export type PveGroundZoneTurn<T extends PveGroundZone> = {
    hits: T[];
    zones: T[];
};

export type PveGroundZoneDebuff = {
    name: "Decrease Damage Given" | "Recoil" | "Poison";
    rounds: number;
    percent: number;
    kind: "negative";
};

/**
 * Ground-zone debuffs use the same refresh durations as authoritative PvP.
 * DDG and Recoil only cover the turn supplied by the patch. Resources-v2
 * Poison keeps its normal two-turn on-spend pressure.
 */
export function pveGroundZoneStatusRounds(tagName: string, combatResourcesV2: boolean): number {
    return tagName === "Poison" && combatResourcesV2 ? 2 : 1;
}

export function pveGroundZoneDebuff(
    tag: PveGroundZoneTag,
    combatResourcesV2: boolean,
): PveGroundZoneDebuff | null {
    if (tag.name !== "Decrease Damage Given" && tag.name !== "Recoil" && tag.name !== "Poison") {
        return null;
    }
    return {
        name: tag.name,
        rounds: pveGroundZoneStatusRounds(tag.name, combatResourcesV2),
        percent: tag.percent ?? (tag.name === "Poison" ? 6 : 30),
        kind: "negative",
    };
}

/**
 * Begin one combatant's turn and consume one round from hostile zones only.
 *
 * A zone's lifetime is measured in opportunities to affect its opponent. This
 * keeps player- and enemy-created patches symmetric even though their turns
 * begin in different Arena functions. The last opportunity still applies, then
 * the zone is removed; moving off the tiles avoids the effect but not expiry.
 */
export function advancePveGroundZonesForTurn<T extends PveGroundZone>(
    zones: readonly T[],
    target: PveGroundZoneOwner,
    targetTile: number,
): PveGroundZoneTurn<T> {
    const hostileOwner: PveGroundZoneOwner = target === "player" ? "enemy" : "player";
    const activeHostile = zones.filter((zone) => zone.owner === hostileOwner && zone.rounds > 0);
    const hits = activeHostile.filter((zone) => zone.tiles.includes(targetTile));
    const nextZones = zones.flatMap((zone) => {
        if (zone.rounds <= 0) return [];
        if (zone.owner !== hostileOwner) return [zone];
        if (zone.rounds <= 1) return [];
        return [{ ...zone, rounds: zone.rounds - 1 } as T];
    });

    return { hits, zones: nextZones };
}
