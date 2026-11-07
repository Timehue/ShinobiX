import type { TowerSession } from '../towers/_tower-session.js';
import type { WorldBossMatchRecord } from './_event.js';

/** A retained session is authority only for this exact sealed team. */
export function isPublishedWorldBossMatch(session: TowerSession | null, match: WorldBossMatchRecord): session is TowerSession {
    if (!session || session.runId !== match.runId || session.worldBossEvent?.eventId !== match.eventId
        || session.worldBossEvent.matchId !== match.matchId) return false;
    const actual = session.actors.filter(actor => actor.side === 'squad' && !actor.ai).map(actor => actor.ownerSlug).sort();
    const expected = match.members.map(member => member.slug).sort();
    return actual.length === expected.length && actual.every((slug, index) => slug === expected[index]);
}
