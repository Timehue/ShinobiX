import type { PlayerRecord } from '../types/character';
import type { WorldSectorCommandPlayer } from '../components/WorldSectorCommandPanel.types';
import { playerSlug as accountKey } from './utils';
import { sameSector } from './utils';
import { peerIsTraveling } from './presence-character';
import { sectorEngagementFor, type SectorWarContestEntryView } from './sector-war-engagement';

export { accountKey as sectorPlayerKey };
export type SectorPlayer = PlayerRecord & { __sleeping?: boolean };

/** Full permitted roster; cosmetic marker budgets never limit action discovery. */
export function sectorPlayerRoster(args: {
    sector: number | null; currentSector: number; viewer: string;
    live: readonly PlayerRecord[]; registered: readonly PlayerRecord[];
    recentlyStruckDown: (name: string) => boolean;
}): SectorPlayer[] {
    const { sector, currentSector, viewer, live, registered, recentlyStruckDown } = args;
    if (sector == null || !sameSector(currentSector, sector)) return [];
    const liveKeys = new Set(live.map(p => accountKey(p.name)));
    const rows = new Map<string, SectorPlayer>();
    for (const player of live) {
        if (sameSector(player.currentSector, sector) && !player.stronghold)
            rows.set(accountKey(player.name), player);
    }
    for (const player of registered) {
        const key = accountKey(player.name);
        if (player.sleeping === true && sameSector(player.currentSector, sector)
            && !liveKeys.has(key) && !recentlyStruckDown(player.name))
            rows.set(key, { ...player, __sleeping: true });
    }
    rows.delete(accountKey(viewer));
    return [...rows.values()].sort((a, b) => accountKey(a.name).localeCompare(accountKey(b.name)));
}

/** Controller projection of the existing travel, battle and capability gates. */
export function projectSectorPlayers(players: readonly SectorPlayer[], options: {
    sector: number; village: string; images: Record<string, string>;
    contest: SectorWarContestEntryView | null; blockedReason?: string; contestBlockedReason?: string; spectateBlockedReason?: string;
}): WorldSectorCommandPlayer[] {
    return players.map(player => {
        const sleeping = Boolean(player.__sleeping);
        const traveling = peerIsTraveling(player);
        const fighting = Boolean(player.inBattle);
        const attackLabel = sectorEngagementFor({ contest: options.contest, sector: options.sector,
            myVillage: options.village, targetVillage: player.village, now: Date.now() });
        const disabledReason = options.blockedReason || (!sleeping && (
            traveling ? 'This player is traveling.' : fighting ? 'This player is already fighting.'
                : attackLabel.kind === 'contest' ? options.contestBlockedReason : undefined));
        return { target: player, name: player.name, level: player.level,
            avatarSrc: options.images['avatar:' + accountKey(player.name)] || player.character?.avatarImage || '',
            sleeping, status: sleeping ? 'Sleeping' : traveling ? 'Traveling' : fighting ? 'Fighting' : 'Ready',
            attackLabel, actionDisabled: Boolean(disabledReason), disabledReason: disabledReason || undefined,
            spectateDisabled: !fighting || sleeping || traveling || Boolean(options.spectateBlockedReason) };
    });
}
