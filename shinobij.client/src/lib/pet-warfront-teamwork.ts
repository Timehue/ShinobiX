import { DUEL_TPS, type DuelResult } from "./pet-duel-sim";

export type WarfrontTeamwork = { tick: number; until: number; side: "player" | "enemy";
    label: string; allies: string[]; target: string };

/** Report completed cooperation, never a predicted AI intention. Two hits by
 * one pet or an AOE are not focus fire. One compact callout owns the HUD. */
export function warfrontTeamwork(result: DuelResult): WarfrontTeamwork[] {
    const plan: WarfrontTeamwork[] = [];
    const hits = new Map<string, { tick: number; actor: string }>();
    for (const event of result.events) {
        if (!event.targetId) continue;
        const actors = result.snapshots[Math.min(result.snapshots.length - 1, Math.max(0, Math.floor(event.t)))]?.actors ?? [];
        const actor = actors.find(a => a.id === event.actorId);
        const target = actors.find(a => a.id === event.targetId);
        if (!actor || !target) continue;
        let label = "";
        let allies = [actor.id];
        if (actor.team === target.team && actor.id !== target.id && target.hp > 0) {
            if (event.type === "shield") label = "ALLY SHIELD";
            if (event.type === "heal" && (event.dmg ?? 0) > 0) label = "ALLY HEAL";
        } else if (event.type === "hit" && (event.dmg ?? 0) > 0 && actor.team !== target.team) {
            const previous = hits.get(target.id);
            hits.set(target.id, { tick: event.t, actor: actor.id });
            if (previous && previous.actor !== actor.id && event.t - previous.tick <= DUEL_TPS * .6
                && actors.some(a => a.id === previous.actor && a.team === actor.team && a.hp > 0)) {
                label = target.hp > 0 ? "FOCUS FIRE" : "FOCUS TAKEDOWN";
                allies = [previous.actor, actor.id];
            }
        }
        if (!label || event.t < (plan.at(-1)?.until ?? -1) + 9) continue;
        plan.push({ tick: event.t, until: event.t + DUEL_TPS * 1.2, side: actor.team, label, allies, target: target.id });
    }
    return plan;
}
