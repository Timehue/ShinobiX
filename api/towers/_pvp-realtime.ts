import { kickTowerPlayers } from '../_realtime/notify.js';
import type { StoredTowerPvpMatch } from './_pvp-session.js';

export type TowerPvpRealtimeReason = 'matched' | 'ready' | 'action' | 'settled' | 'closed';

/** Best-effort revision hint. Authenticated HTTP state remains authoritative. */
export function publishTowerPvpKick(match: StoredTowerPvpMatch, reason: TowerPvpRealtimeReason): void {
    kickTowerPlayers(match.roster.map(member => member.slug), {
        channel: 'pvp',
        reason,
        matchId: match.matchId,
        version: match.version,
    });
}

export function publishTowerPvpQueuedKick(slug: string): void {
    kickTowerPlayers([slug], { channel: 'pvp', reason: 'queued' });
}
