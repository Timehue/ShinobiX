import { DUEL_TPS, type DuelEvent } from "./pet-duel-sim";

export type DuelPlanarPoint = readonly [number, number];

/**
 * Advance a rendered burst without allowing a slow frame to consume the whole
 * route. This is presentation-only: the deterministic replay remains the target,
 * while the visible creature catches up over real rendered frames.
 */
export function boundedBurstStep(
    current: DuelPlanarPoint,
    target: DuelPlanarPoint,
    deltaSeconds: number,
    maxUnitsPerSecond = 21,
    maxUnitsPerFrame = 0.48,
): [number, number] {
    const dx = target[0] - current[0];
    const dz = target[1] - current[1];
    const remaining = Math.hypot(dx, dz);
    if (remaining <= 1e-5) return [target[0], target[1]];
    const maxStep = Math.min(maxUnitsPerFrame, maxUnitsPerSecond * Math.min(Math.max(0, deltaSeconds), 1 / 30));
    const step = Math.min(remaining, maxStep);
    return [current[0] + dx / remaining * step, current[1] + dz / remaining * step];
}

export type DuelMoveOutcomeKind = "hit" | "support" | "whiff" | "none";

export type DuelMoveOutcome = {
    kind: DuelMoveOutcomeKind;
    event: DuelEvent | null;
};

export type DuelAttackDashBeat = {
    startTick: number;
    resolveTick: number;
    actorId: string;
    targetId: string;
    element?: string;
    move?: string;
    outcome: "hit" | "whiff";
};

/** Decide whether a resolved move has earned this actor's one-per-fight hero
 * reveal. Eligibility is per actor, not a global cooldown: one fighter's card
 * must never suppress the opponent's showcase moment. */
export function duelHeroCutEligible({
    actorId,
    eventType,
    move,
    heroMove,
    outcomeKind,
    shownActors,
}: {
    actorId: string;
    eventType: DuelEvent["type"];
    move?: string;
    heroMove?: string;
    outcomeKind: DuelMoveOutcomeKind;
    shownActors: ReadonlySet<string>;
}): boolean {
    if (!actorId || shownActors.has(actorId) || outcomeKind === "none" || outcomeKind === "whiff") return false;
    if (eventType === "ultimate") return outcomeKind === "hit";
    return eventType === "cast" && !!move && move === heroMove;
}

/**
 * Author one showcase cue per fighter from the finished deterministic timeline.
 * We prefer the pet's actual hero move/ultimate, but a short match must not deny
 * one fighter its identity beat simply because that move never came off cooldown.
 * In that case the first successful named attack becomes the reveal; a resolved
 * support technique is the final fallback for support-heavy pets.
 */
export function duelHeroCutEventIndexes(
    events: readonly DuelEvent[],
    heroMoveByActor: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, number>> {
    const candidates = new Map<string, { preferred: number[]; attack: number[]; support: number[] }>();

    events.forEach((event, index) => {
        if (!event.actorId || (event.type !== "cast" && event.type !== "ultimate") || !event.move) return;
        const outcome = duelMoveOutcome(events, index).kind;
        if (outcome === "none" || outcome === "whiff") return;
        const actorCandidates = candidates.get(event.actorId) ?? { preferred: [], attack: [], support: [] };
        const heroMove = heroMoveByActor[event.actorId];
        if ((event.type === "ultimate" && outcome === "hit") || event.move === heroMove) actorCandidates.preferred.push(index);
        else if (outcome === "hit") actorCandidates.attack.push(index);
        else if (outcome === "support") actorCandidates.support.push(index);
        candidates.set(event.actorId, actorCandidates);
    });

    return Object.fromEntries([...candidates.entries()].flatMap(([actorId, actorCandidates]) => {
        const index = actorCandidates.preferred[0] ?? actorCandidates.attack[0] ?? actorCandidates.support[0];
        return index === undefined ? [] : [[actorId, index]];
    }));
}

const SUPPORT_RESOLUTIONS = new Set<DuelEvent["type"]>(["heal", "shield", "buff"]);
const MOVE_OPENERS = new Set<DuelEvent["type"]>(["windup", "cast", "ultimate"]);

/**
 * Resolve the presentation outcome belonging to a named move opener. The combat
 * simulation is already deterministic, so the renderer can use this look-ahead
 * to avoid promising a cinematic payoff for an attack that is about to miss.
 */
export function duelMoveOutcome(
    events: readonly DuelEvent[],
    openerIndex: number,
    maxTicks = Math.round(DUEL_TPS * 2.2),
): DuelMoveOutcome {
    const opener = events[openerIndex];
    if (!opener?.actorId || !MOVE_OPENERS.has(opener.type)) return { kind: "none", event: null };

    for (let index = openerIndex + 1; index < events.length; index++) {
        const event = events[index];
        if (event.t - opener.t > maxTicks) break;
        if (event.actorId !== opener.actorId) continue;

        if (event.type === "hit") {
            // Named hits retain their move name. Do not let an unrelated basic hit
            // make an interrupted signature look as though it has a payoff.
            if (opener.move && event.move !== opener.move) continue;
            return { kind: "hit", event };
        }
        if (event.type === "whiff") return { kind: "whiff", event };
        if (SUPPORT_RESOLUTIONS.has(event.type)) return { kind: "support", event };

        // An ultimate commonly folds into a same-name cast before it resolves.
        // A different named opener means this phrase has ended without a payoff.
        if (MOVE_OPENERS.has(event.type) && event.move && event.move !== opener.move) break;
    }
    return { kind: "none", event: null };
}

/**
 * Find the melee travel phrases that need an authored visible route. A missed
 * gap-closer is still movement: omitting it from the dash track makes the actor
 * race through replay snapshots with no trail or time-control and reads as a
 * teleport. Whiffs qualify only when the attacker actually crossed meaningful
 * distance, so a stationary missed projectile never becomes a body dash.
 */
export function duelAttackDashBeats(
    events: readonly DuelEvent[],
    snapshots: readonly { actors: readonly { id: string; x: number; y: number }[] }[],
): DuelAttackDashBeat[] {
    const beats: DuelAttackDashBeat[] = [];
    const actorAt = (tick: number, actorId: string) => snapshots[Math.min(snapshots.length - 1, Math.max(0, tick))]?.actors.find((actor) => actor.id === actorId);

    events.forEach((event, eventIndex) => {
        if (!event.actorId) return;

        if (event.type === "hit" && !event.ranged && event.targetId) {
            const ultimate = event.move ? [...events].reverse().find((candidate) => candidate.type === "ultimate"
                && candidate.actorId === event.actorId && candidate.move === event.move
                && candidate.t < event.t && event.t - candidate.t <= Math.round(DUEL_TPS * 2.2)) : null;
            const anticipation = event.move ? [...events].reverse().find((candidate) => candidate.type === "windup"
                && candidate.actorId === event.actorId && candidate.move === event.move
                && candidate.t < event.t && event.t - candidate.t <= Math.round(DUEL_TPS * 2.2)) : null;
            beats.push({
                startTick: Math.max(0, ultimate?.t ?? anticipation?.t ?? event.t - 21),
                resolveTick: event.t,
                actorId: event.actorId,
                targetId: event.targetId,
                element: event.element ?? undefined,
                move: event.move ?? undefined,
                outcome: "hit",
            });
            return;
        }

        if (event.type !== "whiff") return;
        const opener = precedingNamedMove(events, eventIndex);
        if (!opener?.targetId || !opener.move) return;
        const start = actorAt(opener.t, event.actorId);
        const end = actorAt(event.t, event.actorId);
        if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 0.8) return;
        beats.push({
            startTick: opener.t,
            resolveTick: event.t,
            actorId: event.actorId,
            targetId: opener.targetId,
            element: opener.element ?? undefined,
            move: opener.move ?? undefined,
            outcome: "whiff",
        });
    });

    return beats;
}

/** Most recent named anticipation phrase responsible for a later whiff. */
export function precedingNamedMove(
    events: readonly DuelEvent[],
    eventIndex: number,
    maxTicks = Math.round(DUEL_TPS * 2.2),
): DuelEvent | null {
    const event = events[eventIndex];
    if (!event?.actorId) return null;
    for (let index = eventIndex - 1; index >= 0; index--) {
        const candidate = events[index];
        if (event.t - candidate.t > maxTicks) break;
        if (candidate.actorId === event.actorId && candidate.move && MOVE_OPENERS.has(candidate.type)) return candidate;
    }
    return null;
}
