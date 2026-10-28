import type { PlayerRecord } from '../types/character';
import type { SectorPeer } from '../components/SectorPeers';
import { playerSlug } from './utils';

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
