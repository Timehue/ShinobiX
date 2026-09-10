import type { ShowdownEvent } from "../../../shared/pet-showdown-contract";

/** Older saved rounds may label physical area attacks as melee. Normalize
 * only their staging before the body, camera and effects share the queue. */
export function showdownPresentationEvent(event: ShowdownEvent): ShowdownEvent {
    return event.t === "action" && event.delivery === "melee" && (event.super || event.targets.some(t => t.splash))
        ? { ...event, delivery: "ranged" } : event;
}

/** Item reactions follow their action on the wire. Play the evade during that
 * action's contact window; the later item beat credits the item without a
 * second body dodge. Reactions to other beat types retain their own timing. */
export function showdownDodgeCues(events: readonly ShowdownEvent[]) {
    const byAction = new Map<number, string[]>(), attachedReactions = new Set<number>();
    let actionIndex = -1;
    events.forEach((event, index) => {
        if (event.t !== "consumable") { actionIndex = event.t === "action" ? index : -1; return; }
        if (actionIndex < 0 || event.effect !== "dodge") return;
        const pets = byAction.get(actionIndex) ?? [];
        pets.push(event.petId);
        byAction.set(actionIndex, pets);
        attachedReactions.add(index);
    });
    return { byAction, attachedReactions };
}

/** One presentation clock for creature travel and its attached effects.
 * Contact remains on the server event's scheduled beat; hit-stop stretches
 * that pose, and recovery uses the remaining beat so roots finish at home. */
export interface ShowdownImpactClock {
    at: number;
    contact: number;
    hitStopUntil: number;
    slowUntil: number;
    slowScale: number;
}

/** Reserve recovery time even when fast playback shortens a finisher beat. */
export function showdownImpactClock(
    beat: { startedAt: number; durationMs: number },
    at: number,
    contact: number,
    cinematic: { hitStopMs: number; slowMotionMs: number; slowScale: number },
): ShowdownImpactClock {
    const available = Math.max(0, beat.startedAt + beat.durationMs - at);
    const timingScale = Math.min(1, available * 0.65 / Math.max(1, cinematic.hitStopMs + cinematic.slowMotionMs));
    const hitStopUntil = at + cinematic.hitStopMs * timingScale;
    return { at, contact, hitStopUntil, slowUntil: hitStopUntil + cinematic.slowMotionMs * timingScale, slowScale: cinematic.slowScale };
}

export function showdownBeatProgress(
    beat: { startedAt: number; durationMs: number; impact?: ShowdownImpactClock },
    now: number,
): number {
    const duration = Math.max(1, beat.durationMs);
    const elapsed = Math.max(0, now - beat.startedAt);
    if (elapsed >= duration) return 1;
    const impact = beat.impact;
    if (!impact || now < impact.at) return elapsed / duration;
    const contact = Math.max(impact.at - beat.startedAt, Math.max(0, Math.min(1, impact.contact)) * duration);
    const stopEnd = Math.max(impact.at, impact.hitStopUntil);
    const slowEnd = Math.max(stopEnd, impact.slowUntil);
    const scale = Math.max(0, Math.min(1, impact.slowScale));
    const frozenTime = (Math.min(now, stopEnd) - impact.at) * 0.06;
    const slowTime = Math.max(0, Math.min(now, slowEnd) - stopEnd) * scale;
    let presented = contact + frozenTime + slowTime;
    if (now > slowEnd) {
        const tail = Math.max(1, beat.startedAt + duration - slowEnd);
        presented += (duration - presented) * Math.min(1, (now - slowEnd) / tail);
    }
    return Math.max(0, Math.min(1, presented / duration));
}
