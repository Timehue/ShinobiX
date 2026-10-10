import { announce } from '../_announce.js';
import type { WorldBossEventStatus } from '../../shared/world-boss-event.js';
import type { WorldBossEventRecord } from './_event.js';

/** Publish important boss phase changes once to the announcement feed and village chats. */
export async function announceWorldBossEventTransition(
    event: WorldBossEventRecord,
    status: WorldBossEventStatus,
): Promise<void> {
    const village = event.targetVillage || event.retreatPenaltyVillage || 'the borderlands';
    let title: string;
    let message: string;

    if (status === 'roaming') {
        const sector = Number.isInteger(event.spawnSector) ? `Sector ${event.spawnSector}` : 'the wilderness';
        title = `${event.bossName} has entered the world`;
        message = `The threat appeared in ${sector} and is advancing toward ${village}. Find its marker on the world map and join a team of up to three.`;
    } else if (status === 'final-stand') {
        title = `${event.bossName}: Final Stand`;
        message = `The boss has reached its final stand near ${village}. Defeat it before the event closes to prevent Ashfall from affecting the village.`;
    } else if (status === 'victory') {
        title = `${event.bossName} has been defeated`;
        message = `The world threat has fallen. Top 15 Hollow Beast Cache awards will be finalized after active team battles settle.`;
    } else if (status === 'retreated' && event.retreatPenaltyApplied) {
        const until = event.retreatPenaltyUntil ? new Date(event.retreatPenaltyUntil).toISOString() : 'the next day';
        title = `${village} suffers Ashfall`;
        message = `${event.bossName} was not stopped in time. Ashfall affects ${village} until ${until}.`;
    } else {
        return;
    }

    await announce({
        type: 'world_boss_event',
        importance: 'high',
        title,
        message,
        village: event.targetVillage,
        meta: { eventId: event.eventId, bossId: event.bossId, status },
    }, { receiptId: `world-boss-event:${event.eventId}:${status}` });
}
