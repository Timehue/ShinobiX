import type { DuelResult } from "./pet-duel-sim";
import { petBattleElement, type PetBattleElement } from "./pet-element-vfx";
import { createActorPoseSample, sampleActorByIdInto } from "./pet-warfront-rite-presentation";

export type WarfrontTechnique = Readonly<{
    actorId: string; targetId: string; element: PetBattleElement;
    contact: number; end: number; signature: boolean; x: number; z: number; heading: number;
}>;
export const WARFRONT_TECHNIQUE_CAP = 2;
/** Named offensive techniques earn a set piece; basics retain their small
 * projectile. Pack whole impact windows once, so effects cannot flicker in
 * and out as competing attacks arrive. AOE has one focal impact, never four
 * copies, and no two grand effects obscure the same victim simultaneously. */
export function buildWarfrontTechniqueTimeline(result: DuelResult): readonly (readonly WarfrontTechnique[])[] {
    const timeline: WarfrontTechnique[][] = Array.from({ length: result.ticks + 37 }, () => []);
    const seen = new Set<string>();
    const target = createActorPoseSample();
    const source = createActorPoseSample();
    const hits = result.events.filter(e => e.type === "hit" && e.move && e.targetId && (e.dmg ?? 0) > 0)
        .sort((a, b) => a.t - b.t || Number(Boolean(b.signature)) - Number(Boolean(a.signature)));
    for (const hit of hits) {
        const element = petBattleElement(hit.element);
        const key = `${hit.actorId}:${hit.t}`;
        if (element === "None" || seen.has(key)) continue;
        seen.add(key);
        const active = timeline[hit.t];
        if (!active || active.length >= WARFRONT_TECHNIQUE_CAP
            || active.some(a => a.actorId === hit.actorId || a.targetId === hit.targetId)) continue;
        sampleActorByIdInto(result, hit.targetId!, hit.t, target);
        sampleActorByIdInto(result, hit.actorId, hit.t, source);
        const technique: WarfrontTechnique = { actorId: hit.actorId, targetId: hit.targetId!, element,
            contact: hit.t, end: hit.t + (hit.signature ? 36 : 27), signature: Boolean(hit.signature), x: target.x, z: target.z,
            heading: Math.atan2(target.x - source.x, target.z - source.z) };
        for (let tick = technique.contact; tick < technique.end && tick < timeline.length; tick++) timeline[tick].push(technique);
    }
    return timeline;
}

export function warfrontTechniqueProgress(technique: WarfrontTechnique, tick: number): number {
    return (tick - technique.contact) / (technique.end - technique.contact);
}
