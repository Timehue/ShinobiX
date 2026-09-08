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
