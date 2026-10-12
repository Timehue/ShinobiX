import { hollowGateWandererFriendly, type HollowGateWanderer } from '../../shared/hollow-gate-wanderers.js';
import type { HollowGateRunToken } from './_run-token.js';

export function hollowGateWanderersForRun(run: HollowGateRunToken): HollowGateWanderer[] | undefined {
    const floor = run.currentFloor ?? 1;
    return run.wanderers?.[String(floor)]?.map(npc => ({ ...npc, spent: hollowGateWandererFriendly(npc)
        ? run.resolvedEventIds?.includes(`event:${floor}:traveler:${npc.nodeId}`) === true
        : run.resolvedEncounterIds?.includes(`${floor}:battle:${npc.nodeId}`) === true }));
}
export function hollowGateWandererForNode(run: HollowGateRunToken, nodeId: string) {
    return hollowGateWanderersForRun(run)?.find(npc => npc.nodeId === nodeId);
}
