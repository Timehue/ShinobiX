import type { TowerActor } from './towers-api';
export type TowerImpactCue = { actorId: string; tile: number; kind: 'break' | 'heavy' | 'boss'; label: string };
/** Derived only from consecutive authoritative snapshots; never invents damage. */
export function towerImpactCues(before: readonly TowerActor[], after: readonly TowerActor[], bossId?: string): TowerImpactCue[] {
    const previous = new Map(before.map(actor => [actor.id, actor]));
    return after.flatMap(actor => {
        const was = previous.get(actor.id);
        if (!was || was.hp <= 0) return [];
        const cues: TowerImpactCue[] = [];
        if (was.shield > 0 && actor.shield <= 0) cues.push({ actorId: actor.id, tile: actor.pos, kind: 'break', label: 'GUARD BROKEN' });
        if (actor.id === bossId && actor.hp <= 0) cues.push({ actorId: actor.id, tile: actor.pos, kind: 'boss', label: 'COMMANDER DEFEATED' });
        else if (was.hp - actor.hp >= actor.maxHp * .2) cues.push({ actorId: actor.id, tile: actor.pos, kind: 'heavy', label: 'HEAVY HIT' });
        return cues;
    });
}
