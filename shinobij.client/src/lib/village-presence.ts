import type { ServerPlayerSummary } from "../types/character";

export type VillagePresencePlayer = {
    name: string;
    level: number;
    village: string;
};

export type VillagePresence = {
    onlineTotal: number;
    villageOnline: number;
    inField: number;
    visiblePlayers: VillagePresencePlayer[];
};

function isPlayerFacingSummary(player: ServerPlayerSummary, currentName: string): boolean {
    const name = player.name.trim();
    if (!player.online || !name || name.toLowerCase() === currentName.trim().toLowerCase()) return false;
    if (/^clan[-\s]/i.test(name)) return false;
    return player.character?.rankTitle?.trim().toLowerCase() !== "admin";
}

/**
 * Builds a truthful village-presence projection from the roster the app shell
 * already polls. The mounted player is counted as online; no synthetic names,
 * bots, or extra network requests are introduced here.
 */
export function deriveVillagePresence(
    currentName: string,
    currentVillage: string,
    players: ServerPlayerSummary[],
): VillagePresence {
    const byName = new Map<string, ServerPlayerSummary>();
    for (const player of players) {
        if (!isPlayerFacingSummary(player, currentName)) continue;
        const key = player.name.trim().toLowerCase();
        const prior = byName.get(key);
        if (!prior || Number(player.lastSeenAt ?? 0) >= Number(prior.lastSeenAt ?? 0)) byName.set(key, player);
    }

    const villageKey = currentVillage.trim().toLowerCase();
    const onlinePlayers = [...byName.values()];
    const sameVillage = onlinePlayers.filter((player) => player.village.trim().toLowerCase() === villageKey);
    const otherVillages = onlinePlayers.filter((player) => player.village.trim().toLowerCase() !== villageKey);
    const visiblePlayers = [...sameVillage, ...otherVillages]
        .slice(0, 3)
        .map((player) => ({
            name: player.name.trim(),
            level: Math.max(1, Math.floor(Number(player.level) || 1)),
            village: player.village.trim(),
        }));

    return {
        onlineTotal: onlinePlayers.length + 1,
        villageOnline: sameVillage.length + 1,
        inField: onlinePlayers.filter((player) => Number(player.currentSector ?? 0) > 0).length,
        visiblePlayers,
    };
}
