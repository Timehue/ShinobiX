import { DUEL_TPS, type DuelEvent } from "./pet-duel-sim";

const TELL_TYPES = new Set<DuelEvent["type"]>(["windup", "cast", "ultimate"]);
const MAX_TELL_LEAD_TICKS = DUEL_TPS * 1.5;

/** The streak appears two ticks before contact and remains six ticks after it:
 * 8 / 30s ~= 267ms. It now supports the body beat instead of owning it. */
export const ATTACK_STREAK_LEAD_TICKS = 2;
export const ATTACK_STREAK_TRAIL_TICKS = 6;
export const ATTACK_STREAK_DURATION_MS = ((ATTACK_STREAK_LEAD_TICKS + ATTACK_STREAK_TRAIL_TICKS) / DUEL_TPS) * 1000;
/** At 60Hz this is two complete rendered frames. */
export const ATTACK_CONTACT_HOLD_TICKS = DUEL_TPS * (2 / 60);
/** Start at full value on the damage edge, then clear in two sim frames. */
export const ATTACK_CONTACT_FLASH_TICKS = 2;

export const BODY_LUNGE_LEAD_TICKS = 3;
export const BODY_LUNGE_RELEASE_TICKS = 3;
export const BODY_RECOIL_RECOVERY_TICKS = 9;
export const BODY_KO_EXIT_TICKS = 24;
export const BODY_LUNGE_DISTANCE = 0.42;
export const BODY_RECOIL_DISTANCE = 0.52;
export const BODY_KO_EXIT_DISTANCE = 1.8;

export type WarfrontAttackCue = Readonly<{
    actorId: string;
    targetId: string;
    side: "player" | "enemy";
    /** Damage-owner element copied from the authoritative hit event. */
    element: string | null;
    tellTick: number;
    contactTick: number;
    hits: number;
    lethal: boolean;
    koTick: number | null;
}>;

/**
 * Selects the single combat sentence allowed to own a ground rune.
 *
 * Several fighters can legitimately wind up, recover, or stagger at once, but
 * drawing one ring for every state turns the cast into board tokens. An
 * upcoming/contact cue therefore outranks a fading cue; ties resolve to the
 * nearest contact and then stable event order. The return value is an actor id,
 * so both renderers can submit at most one hairline rune for the whole frame.
 */
export function authoritativeGroundingActorAt(
    cues: readonly WarfrontAttackCue[],
    tick: number,
): string | null {
    let selected: WarfrontAttackCue | null = null;
    let selectedIndex = -1;
    for (let index = 0; index < cues.length; index++) {
        const cue = cues[index];
        if (tick < cue.tellTick || tick > cue.contactTick + BODY_LUNGE_RELEASE_TICKS) continue;
        if (!selected) {
            selected = cue;
            selectedIndex = index;
            continue;
        }
        const cueBeforeContact = tick <= cue.contactTick;
        const selectedBeforeContact = tick <= selected.contactTick;
        const cueDistance = Math.abs(cue.contactTick - tick);
        const selectedDistance = Math.abs(selected.contactTick - tick);
        if ((cueBeforeContact && !selectedBeforeContact)
            || (cueBeforeContact === selectedBeforeContact && cueDistance < selectedDistance)
            || (cueBeforeContact === selectedBeforeContact && cueDistance === selectedDistance && cue.hits > selected.hits)
            || (cueBeforeContact === selectedBeforeContact && cueDistance === selectedDistance && cue.hits === selected.hits && index > selectedIndex)) {
            selected = cue;
            selectedIndex = index;
        }
    }
    return selected?.actorId ?? null;
}

/** Pair damage with the actor's latest authoritative tell. AOE hits retain one
 * line per target; exact duplicate hit records merge into one brighter phrase. */
export function warfrontAttackCues(events: readonly DuelEvent[]): WarfrontAttackCue[] {
    const pendingTell = new Map<string, DuelEvent>();
    const cueIndex = new Map<string, number>();
    const cues: Array<{
        actorId: string;
        targetId: string;
        side: "player" | "enemy";
        element: string | null;
        tellTick: number;
        contactTick: number;
        hits: number;
        lethal: boolean;
        koTick: number | null;
    }> = [];

    for (const event of events) {
        if (TELL_TYPES.has(event.type) && event.targetId) {
            pendingTell.set(event.actorId, event);
            continue;
        }
        if (event.type === "whiff") {
            pendingTell.delete(event.actorId);
            continue;
        }
        if (event.type !== "hit" || !event.targetId) continue;
        const tell = pendingTell.get(event.actorId);
        const tellTick = tell && tell.t <= event.t && event.t - tell.t <= MAX_TELL_LEAD_TICKS
            ? tell.t
            : event.t;
        const key = `${event.actorId}\u0000${event.targetId}\u0000${event.t}`;
        const existing = cueIndex.get(key);
        if (existing !== undefined) {
            cues[existing].hits += 1;
            continue;
        }
        cueIndex.set(key, cues.length);
        cues.push({
            actorId: event.actorId,
            targetId: event.targetId,
            side: event.side,
            element: event.element ?? tell?.element ?? null,
            tellTick,
            contactTick: event.t,
            hits: 1,
            lethal: false,
            koTick: null,
        });
    }
    // KO records are authoritative and ordered after their damage edge. When
    // multiple actors touch the same target on one tick, only the final hit
    // before the KO owns the lethal continuation; the target never stacks exits.
    for (let koIndex = 0; koIndex < events.length; koIndex++) {
        const ko = events[koIndex];
        if (ko.type !== "ko" || !ko.actorId) continue;
        let lethalHit: DuelEvent | undefined;
        for (let hitIndex = koIndex - 1; hitIndex >= 0; hitIndex--) {
            const candidate = events[hitIndex];
            if (candidate.t < ko.t - 1) break;
            if (candidate.type === "hit" && candidate.targetId === ko.actorId && candidate.t <= ko.t) {
                lethalHit = candidate;
                break;
            }
        }
        if (!lethalHit?.targetId) continue;
        const index = cueIndex.get(`${lethalHit.actorId}\u0000${lethalHit.targetId}\u0000${lethalHit.t}`);
        if (index === undefined) continue;
        cues[index].lethal = true;
        cues[index].koTick = ko.t;
    }
    return cues;
}

export type WarfrontBodyContactBeat = Readonly<{
    actorId: string;
    tick: number;
    role: "attacker" | "target";
    cues: readonly WarfrontAttackCue[];
    hits: number;
    lethal: boolean;
    koTick: number | null;
}>;

/** Collapse same-tick AOE/duplicate/concurrent events into one beat per role.
 * An actor may retain both an outgoing pre-contact lunge and an incoming recoil
 * on the same tick; the render selector makes the target beat win at contact,
 * so those phrases never stack or fight over one presentation transform. */
export function warfrontBodyContactBeats(cues: readonly WarfrontAttackCue[]): Map<string, WarfrontBodyContactBeat[]> {
    type MutableBeat = {
        actorId: string;
        tick: number;
        role: "attacker" | "target";
        cues: WarfrontAttackCue[];
        hits: number;
        lethal: boolean;
        koTick: number | null;
    };
    const beatsByActor = new Map<string, MutableBeat[]>();
    const beatsByKey = new Map<string, MutableBeat>();
    const append = (actorId: string, role: "attacker" | "target", cue: WarfrontAttackCue) => {
        const key = `${actorId}\u0000${cue.contactTick}\u0000${role}`;
        let beat = beatsByKey.get(key);
        if (!beat) {
            beat = { actorId, tick: cue.contactTick, role, cues: [], hits: 0, lethal: false, koTick: null };
            beatsByKey.set(key, beat);
            const list = beatsByActor.get(actorId);
            if (list) list.push(beat);
            else beatsByActor.set(actorId, [beat]);
        }
        if (beat.cues.includes(cue)) return;
        beat.cues.push(cue);
        beat.hits += cue.hits;
        if (role === "target" && cue.lethal) {
            beat.lethal = true;
            beat.koTick = cue.koTick;
        }
    };
    for (const cue of cues) {
        append(cue.actorId, "attacker", cue);
        append(cue.targetId, "target", cue);
    }
    for (const beats of beatsByActor.values()) beats.sort((a, b) => a.tick - b.tick || (a.role === "attacker" ? -1 : 1));
    return beatsByActor as Map<string, WarfrontBodyContactBeat[]>;
}

export type WarfrontContactDirection = Readonly<{ x: number; z: number }>;

export function warfrontContactDirection(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    fallbackX = 1,
    fallbackZ = 0,
): WarfrontContactDirection {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const length = Math.hypot(dx, dz);
    if (length > 1e-5) return { x: dx / length, z: dz / length };
    const fallbackLength = Math.hypot(fallbackX, fallbackZ);
    return fallbackLength > 1e-5
        ? { x: fallbackX / fallbackLength, z: fallbackZ / fallbackLength }
        : { x: 1, z: 0 };
}

const smoothstep = (value: number): number => {
    const clamped = Math.max(0, Math.min(1, value));
    return clamped * clamped * (3 - 2 * clamped);
};

export type WarfrontBodyReactionPhase = {
    active: boolean;
    lunge: number;
    recoil: number;
    recovery: number;
    koExit: number;
};

export const createWarfrontBodyReactionPhase = (): WarfrontBodyReactionPhase => ({
    active: false,
    lunge: 0,
    recoil: 0,
    recovery: 0,
    koExit: 0,
});

/** Pure presentation envelope. It never changes simulation X/Z: renderers
 * multiply these normalized values by bounded child offsets. The `Into` form
 * lets the render loop reuse one sample instead of allocating every frame. */
export function warfrontBodyReactionPhaseInto(
    beat: WarfrontBodyContactBeat,
    tick: number,
    out: WarfrontBodyReactionPhase,
): WarfrontBodyReactionPhase {
    out.active = false;
    out.lunge = 0;
    out.recoil = 0;
    out.recovery = 0;
    out.koExit = 0;
    if (beat.role === "attacker") {
        const start = beat.tick - BODY_LUNGE_LEAD_TICKS;
        const end = beat.tick + BODY_LUNGE_RELEASE_TICKS;
        let lunge = 0;
        if (tick >= start && tick <= beat.tick) lunge = smoothstep((tick - start) / BODY_LUNGE_LEAD_TICKS);
        else if (tick > beat.tick && tick < end) {
            const heldAge = Math.max(0, tick - beat.tick - ATTACK_CONTACT_HOLD_TICKS);
            const releaseSpan = Math.max(0.001, BODY_LUNGE_RELEASE_TICKS - ATTACK_CONTACT_HOLD_TICKS);
            lunge = 1 - smoothstep(heldAge / releaseSpan);
        }
        out.active = lunge > 0;
        out.lunge = lunge;
        return out;
    }

    const age = tick - beat.tick;
    if (age < 0) return out;
    if (beat.lethal) {
        const exitAge = Math.max(0, tick - (beat.koTick ?? beat.tick));
        const koExit = smoothstep(exitAge / BODY_KO_EXIT_TICKS);
        const recoil = 1 - koExit;
        // Keep the terminal offset after the envelope completes. The renderer
        // fades/despawns the body there; returning to zero first would create a
        // one-frame corpse pop back onto its authoritative root.
        out.active = true;
        out.recoil = recoil;
        out.koExit = koExit;
        return out;
    }
    const recoil = age <= ATTACK_CONTACT_HOLD_TICKS
        ? 1
        : age < BODY_RECOIL_RECOVERY_TICKS
            ? 1 - smoothstep((age - ATTACK_CONTACT_HOLD_TICKS) / (BODY_RECOIL_RECOVERY_TICKS - ATTACK_CONTACT_HOLD_TICKS))
            : 0;
    const recovery = age < ATTACK_CONTACT_HOLD_TICKS
        ? 0
        : Math.min(1, (age - ATTACK_CONTACT_HOLD_TICKS) / (BODY_RECOIL_RECOVERY_TICKS - ATTACK_CONTACT_HOLD_TICKS));
    out.active = recoil > 0;
    out.recoil = recoil;
    out.recovery = recovery;
    return out;
}

export function warfrontBodyReactionPhase(beat: WarfrontBodyContactBeat, tick: number): WarfrontBodyReactionPhase {
    return warfrontBodyReactionPhaseInto(beat, tick, createWarfrontBodyReactionPhase());
}

export type WarfrontAttackCuePhase = {
    visible: boolean;
    origin: number;
    streak: number;
    contact: number;
    recovery: number;
    contactHold: boolean;
};

export function warfrontAttackCuePhase(cue: WarfrontAttackCue, tick: number): WarfrontAttackCuePhase {
    const streakStart = cue.contactTick - ATTACK_STREAK_LEAD_TICKS;
    const streakEnd = cue.contactTick + ATTACK_STREAK_TRAIL_TICKS;
    const origin = tick < cue.tellTick || tick > cue.contactTick
        ? 0
        : Math.max(0, Math.min(1, (tick - cue.tellTick + 1) / Math.max(1, cue.contactTick - cue.tellTick)));
    const streak = tick < streakStart || tick > streakEnd
        ? 0
        : tick <= cue.contactTick
            ? Math.max(0, Math.min(1, (tick - streakStart) / ATTACK_STREAK_LEAD_TICKS))
            : Math.max(0, 1 - (tick - cue.contactTick) / ATTACK_STREAK_TRAIL_TICKS);
    const contactAge = tick - cue.contactTick;
    const contact = contactAge < 0 || contactAge > ATTACK_CONTACT_FLASH_TICKS
        ? 0
        : 1 - contactAge / ATTACK_CONTACT_FLASH_TICKS;
    const recovery = contactAge < ATTACK_CONTACT_HOLD_TICKS || contactAge > ATTACK_STREAK_TRAIL_TICKS
        ? 0
        : (contactAge - ATTACK_CONTACT_HOLD_TICKS) / (ATTACK_STREAK_TRAIL_TICKS - ATTACK_CONTACT_HOLD_TICKS);
    return {
        visible: origin > 0 || streak > 0 || contact > 0,
        origin,
        streak,
        contact,
        recovery,
        contactHold: contactAge >= 0 && contactAge < ATTACK_CONTACT_HOLD_TICKS,
    };
}
