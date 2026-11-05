import type { PlayerRecord } from '../types/character';
import type { SectorPeer } from '../components/SectorPeers';
import { playerSlug } from './utils';

export type ContinuousWorldPeersProps = { sector: number; selfName: string; sharedImages: Record<string, string>; sleepers: SectorPeer[] };

function sameSleepers(a: readonly SectorPeer[], b: readonly SectorPeer[]): boolean {
    return a === b || (a.length === b.length && a.every((s, i) => s.name === b[i].name && s.tile === b[i].tile
        && Object.is(s.level, b[i].level) && s.sleeping === b[i].sleeping && s.avatar === b[i].avatar));
}

/**
 * ContinuousWorldPeers' memo comparator. WorldMap rebuilds `sleepers` on every
 * render, so it is compared by content; the other props by identity.
 */
export function sameContinuousWorldPeersProps(a: ContinuousWorldPeersProps, b: ContinuousWorldPeersProps): boolean {
    return a.sector === b.sector && a.selfName === b.selfName && a.sharedImages === b.sharedImages && sameSleepers(a.sleepers, b.sleepers);
}

/** Cosmetic world markers. The action roster remains complete and uncapped. */
export function worldPeerRoster(sector: number, selfName: string, nearby: readonly PlayerRecord[],
    live: readonly PlayerRecord[], sleepers: readonly SectorPeer[]): PlayerRecord[] {
    const byName = new Map<string, PlayerRecord>();
    for (const peer of [...nearby, ...live.filter(p => p.currentSector === sector)]) {
        const key = playerSlug(peer.name), previous = byName.get(key);
        if (!previous || (peer.movementSequence ?? 0) >= (previous.movementSequence ?? 0)) byName.set(key, peer);
    }
    const liveNames = new Set(live.map(p => playerSlug(p.name)));
    for (const sleeper of sleepers) {
        const key = playerSlug(sleeper.name);
        if (liveNames.has(key)) continue;
        byName.set(key, { name: sleeper.name, level: sleeper.level, currentSector: sector,
            tile: sleeper.tile, sleeping: true, village: '', specialty: 'Ninjutsu',
            character: { avatarImage: sleeper.avatar || '' } as PlayerRecord['character'] });
    }
    return [...byName.values()].filter(p => playerSlug(p.name) !== playerSlug(selfName) && !p.stronghold)
        .sort((a, b) => Number(b.currentSector === sector) - Number(a.currentSector === sector));
}
