import type { DuelResult } from "./pet-duel-sim";
import { warfrontAttackCues } from "./pet-warfront-attack-causality";
import { createActorPoseSample, sampleActorByIdInto } from "./pet-warfront-rite-presentation";

export type WarfrontActionVisual = Readonly<{
    actorId: string;
    targetId: string;
    element: string | null;
    kind: "attack" | "support";
    start: number;
    contact: number;
    end: number;
    ox: number; oz: number; tx: number; tz: number;
}>;

/** One visible action per actor, including melee, misses and support. Snapshot
 * projectiles are born AFTER damage in this simulation, so they cannot own
 * attack presentation. Index the small windows once, not the entire replay
 * on every frame. A multi-target move still has one travelling silhouette. */
export function buildWarfrontActionTimeline(
    result: DuelResult,
    elements: ReadonlyMap<string, string | null | undefined>,
): readonly (readonly WarfrontActionVisual[])[] {
    const actions: WarfrontActionVisual[] = [];
    const seen = new Set<string>();
    const origin = createActorPoseSample();
    const target = createActorPoseSample();
    const add = (actorId: string, targetId: string, element: string | null | undefined, tell: number, contact: number, kind: WarfrontActionVisual["kind"]) => {
        const key = `${actorId}:${contact}`;
        if (seen.has(key)) return;
        seen.add(key);
        const start = Math.max(0, Math.min(contact - 6, Math.max(tell, contact - 10)));
        sampleActorByIdInto(result, actorId, start, origin);
        sampleActorByIdInto(result, targetId, contact, target);
        actions.push({ actorId, targetId, element: element ?? elements.get(actorId) ?? null, kind,
            start, contact, end: contact + 3,
            ox: origin.x, oz: origin.z, tx: target.x, tz: target.z });
    };
    for (const cue of warfrontAttackCues(result.events)) {
        add(cue.actorId, cue.targetId, cue.element, cue.tellTick, cue.contactTick, "attack");
    }
    for (const event of result.events) {
        if ((event.type === "heal" || event.type === "shield" || event.type === "whiff") && event.targetId) {
            add(event.actorId, event.targetId, event.element, event.t - 8, event.t,
                event.type === "whiff" ? "attack" : "support");
        }
    }
    actions.sort((a, b) => a.contact - b.contact);
    const timeline: WarfrontActionVisual[][] = Array.from({ length: result.ticks + 4 }, () => []);
    for (const action of actions) {
        for (let tick = action.start; tick <= action.end && tick < timeline.length; tick++) {
            const slots = timeline[tick];
            const previous = slots.findIndex((entry) => entry.actorId === action.actorId);
            if (previous < 0) slots.push(action);
            else if (Math.abs(action.contact - tick) < Math.abs(slots[previous].contact - tick)) slots[previous] = action;
        }
    }
    return timeline;
}

export function warfrontActionProgress(action: WarfrontActionVisual, tick: number): number {
    return Math.max(0, Math.min(1, (tick - action.start) / Math.max(1, action.contact - action.start)));
}
