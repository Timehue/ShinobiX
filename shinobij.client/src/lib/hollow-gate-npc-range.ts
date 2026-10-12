import type { HollowGateShrineRun } from '../types/character';

/** Keep this small range check independent of the lazy gift and API handlers. */
export function hollowGateNearbyTraveler(run: HollowGateShrineRun | null, index: number) {
    if (!run) return;
    const distance = Math.abs(index % run.width - run.playerX) + Math.abs(Math.floor(index / run.width) - run.playerY);
    if (distance > 1) return;
    return run.wanderers?.find(n => !n.spent && n.tile === index && (n.role === 'medic' || n.role === 'wayfarer'));
}

export const hollowGateNpcCanTalk = (run: HollowGateShrineRun | null, index: number) => hollowGateNearbyTraveler(run, index)
    || !!run && index === run.playerY * run.width + run.playerX && run.tiles[index]?.kind === 'npc' && !run.tiles[index].resolved;
