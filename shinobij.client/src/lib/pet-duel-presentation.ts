import { DUEL_TPS, type DuelEvent, type DuelSnapshot } from "./pet-duel-sim";

export type DuelPlanarPoint = readonly [number, number];

/** Minimum wall-clock gap between full-screen presentation beats in a party duel. */
export const PARTY_SPOTLIGHT_COOLDOWN_SECONDS = 0.38;

/** Rank simultaneous combat events so a 2v2 frame has one clear visual subject. */
export function duelSpectaclePriority(event: DuelEvent): number {
    if (event.type === "ko") return 1_000;
    if (event.type === "ultimate") return 900;
    if (event.type === "hit") {
        if (event.signature) return 800;
        if (event.crit) return 700;
        if (event.kind === "crush" || event.kind === "push") return 600;
        if (event.move) return 500;
        return 50;
    }
    if (event.type === "heal" || event.type === "shield" || event.type === "buff") return 350;
    if (event.type === "cast") return 300;
    if (event.type === "windup") return 200;
    if (event.type === "dodge" || event.type === "maneuver" || event.type === "whiff") return 100;
    return 0;
}

/**
 * Pick a single authored spectacle beat from events crossed by one render frame.
 * Minor contacts and locomotion stay local; they do not compete for the camera.
 */
export function selectDuelSpotlightEvent(events: readonly DuelEvent[]): DuelEvent | null {
    let best: DuelEvent | null = null;
    let bestPriority = 199;
    for (const event of events) {
        const priority = duelSpectaclePriority(event);
        if (priority > bestPriority) {
            best = event;
            bestPriority = priority;
        }
    }
    return best;
}

/** Append an item while retaining only the newest bounded presentation entries. */
export function appendCapped<T>(items: readonly T[], item: T, limit: number): T[] {
    if (limit <= 0) return [];
    return [...items.slice(Math.max(0, items.length - limit + 1)), item];
}

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

export type DuelFinisherOutcome = {
    hit: DuelEvent;
    targetId: string;
    resolveTick: number;
};

/**
 * Identify an opener whose authoritative payoff knocks its target out. This is
 * presentation look-ahead only: it lets the camera and mix create anticipation
 * without guessing, changing damage, or promising a finisher that will miss.
 */
export function duelFinisherOutcome(
    events: readonly DuelEvent[],
    snapshots: readonly DuelSnapshot[],
    openerIndex: number,
): DuelFinisherOutcome | null {
    const outcome = duelMoveOutcome(events, openerIndex);
    const hit = outcome.kind === "hit" ? outcome.event : null;
    if (!hit?.targetId) return null;
    const target = snapshots[Math.min(snapshots.length - 1, Math.max(0, hit.t))]
        ?.actors.find((actor) => actor.id === hit.targetId);
    if (!target || target.hp > 0) return null;
    return { hit, targetId: hit.targetId, resolveTick: hit.t };
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

export type PetOpeningTactic = {
    stance: 0 | 1 | 2;
    name: string;
    short: string;
    behavior: string;
    strength: string;
    tradeoff: string;
    color: string;
    glyph: string;
};

export const PET_OPENING_TACTICS: readonly PetOpeningTactic[] = [
    {
        stance: 0,
        name: "Pressure",
        short: "Close distance and commit",
        behavior: "Your pet pursues aggressively, attacks more often, and spends less time resetting its spacing.",
        strength: "Best for denying setup and forcing ranged pets into close exchanges.",
        tradeoff: "Commits harder, dodges less, and can be punished by a patient counter-fighter.",
        color: "#f87171",
        glyph: "▲",
    },
    {
        stance: 1,
        name: "Adaptive",
        short: "Read the fight and adjust",
        behavior: "Your pet balances pursuit, spacing, dodging, and recovery using its natural combat instincts.",
        strength: "Reliable into unknown opponents and flexible when momentum changes.",
        tradeoff: "Offers no extreme advantage and may surrender tempo to a specialized game plan.",
        color: "#93c5fd",
        glyph: "◆",
    },
    {
        stance: 2,
        name: "Counter",
        short: "Hold space and retaliate",
        behavior: "Your pet maintains more distance, favors evasive reads, and waits for safer openings.",
        strength: "Best for punishing reckless pressure and protecting a fragile or ranged fighter.",
        tradeoff: "Attacks less often and can allow support or ranged opponents time to establish control.",
        color: "#5eead4",
        glyph: "▼",
    },
] as const;

export const PET_DUEL_NEUTRAL_PLAYBACK_SCALE = 1.38;
export const PET_DUEL_COMMAND_CATCHUP_SCALE = 1.72;
export const PET_DUEL_COMMAND_CATCHUP_SECONDS = 2.2;

export function petDuelImpactStrength(damageFraction: number, critical: boolean): number {
    const fraction = Number.isFinite(damageFraction) ? Math.max(0, damageFraction) : 0;
    return Math.min(1.25, 0.48 + fraction * 1.55 + (critical ? 0.24 : 0));
}

export type PetDuelAttackRhythm = Readonly<{
    pulseMultiplier: number;
    anticipationShare: number;
    contactShare: number;
}>;

/** A readable anticipation/contact/recovery rhythm derived from combat weight. */
export function petDuelAttackRhythm(damageFraction: number, critical: boolean, heavySlam = false): PetDuelAttackRhythm {
    const fraction = Number.isFinite(damageFraction) ? Math.max(0, Math.min(1, damageFraction)) : 0;
    const heavy = heavySlam || critical || fraction >= 0.55;
    const quick = !heavy && fraction <= 0.28;
    if (heavy) return Object.freeze({ pulseMultiplier: critical ? 1.62 : 1.5, anticipationShare: 0.34, contactShare: 0.28 });
    if (quick) return Object.freeze({ pulseMultiplier: 0.74, anticipationShare: 0.23, contactShare: 0.18 });
    return Object.freeze({ pulseMultiplier: 1, anticipationShare: 0.29, contactShare: 0.22 });
}

export type PetDuelContactTiming = Readonly<{
    hitStop: number;
    shake: number;
    savorScale: number;
    savorHold: number;
    zoomKick: number;
    aimHold: number;
    cameraBiasHold: number;
}>;

/**
 * One hierarchy for contact weight. Keeping these values together prevents a
 * basic poke from inheriting a finisher camera while still guaranteeing that a
 * player-authored light hit has visible response.
 */
export function petDuelContactTiming({
    damageFraction,
    critical = false,
    heavy = false,
    dash = false,
    perfect = false,
    playerAuthored = false,
    signature = false,
    ability = false,
}: {
    damageFraction: number;
    critical?: boolean;
    heavy?: boolean;
    dash?: boolean;
    perfect?: boolean;
    playerAuthored?: boolean;
    signature?: boolean;
    ability?: boolean;
}): PetDuelContactTiming {
    const fraction = Number.isFinite(damageFraction) ? Math.max(0, Math.min(1, damageFraction)) : 0;
    const floor = playerAuthored ? 1 : 0;
    const hitStop = Math.min(0.36,
        Math.min(0.18, 0.045 + fraction * 0.5)
        + (critical ? 0.04 : 0) + (heavy ? 0.05 : 0) + (dash ? 0.11 : 0)
        + floor * 0.02 + (perfect ? 0.08 : 0));
    const shake = 0.5 + fraction * 2.4 + (critical ? 0.7 : 0) + (heavy ? 0.9 : 0)
        + (dash ? 1.6 : 0) + floor * 0.4 + (perfect ? 1.35 : 0);
    const savorScale = signature ? 0.48 : critical || heavy ? 0.72 : dash ? 0.54 : ability ? 0.98 : playerAuthored ? 1.02 : 1;
    const savorHold = signature ? 0.22 : critical || heavy ? 0.12 : dash ? 0.26 : ability ? 0.04 : playerAuthored ? 0.03 : 0;
    const zoomKick = signature ? 3.2 : critical ? 2.8 : dash ? 2.65 : ability || heavy ? 1.45 : 0.42;
    return Object.freeze({
        hitStop,
        shake,
        savorScale,
        savorHold,
        zoomKick,
        aimHold: heavy || critical || signature ? 0.44 : ability || dash ? 0.3 : 0.18,
        cameraBiasHold: heavy || critical || signature ? 0.36 : ability || dash ? 0.22 : 0.14,
    });
}
