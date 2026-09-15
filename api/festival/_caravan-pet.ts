import type { CaravanProgress } from '../../shared/sunscar/caravan-types.js';
/** Only a saved rare-trail choice can authorize the normal wild encounter from
 * inside the expedition. The request identity is sealed by the caravan host. */
export function caravanPetDiscovery(character: Record<string, unknown> | undefined, runId: unknown, requestId: unknown): boolean {
    const run = (character?.sunscarCaravan as CaravanProgress | undefined)?.current;
    return typeof runId === 'string' && !!runId && !!run && run.id === runId && !run.result
        && run.petEncounter?.state === 'pending' && run.petEncounter.requestId === requestId
        && run.discoveries.includes('The luminous pet trail');
}
