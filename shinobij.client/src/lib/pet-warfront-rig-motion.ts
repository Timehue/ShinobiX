import type { DuelResult } from "./pet-duel-sim";
import type { WarfrontAttackCue } from "./pet-warfront-attack-causality";

/** Leave anticipation before launch, then land exactly on recorded contact. */
export function warfrontReleaseTick(tell: number, contact: number): number {
    return Math.max(0, contact <= tell ? contact - 6 : Math.floor(contact - Math.min(10, (contact - tell) * .6)));
}

export function warfrontDeliveryAt(cues: readonly WarfrontAttackCue[], tick: number) {
    const cue = cues.find(c => tick >= c.tellTick && tick <= c.contactTick + .5);
    if (!cue) return null;
    const release = warfrontReleaseTick(cue.tellTick, cue.contactTick);
    const windup = tick < release;
    return { motion: windup ? "windup" as const : "strike" as const,
        progress: Math.min(1, (tick - (windup ? cue.tellTick : release)) / Math.max(.5,
            windup ? release - cue.tellTick : cue.contactTick - release)) };
}

type AttackPhase = { state: string; start: number; end: number };
export type WarfrontRigTrack = Array<AttackPhase | null>;

/** Index the actual state durations once per replay, using sampleActorInto's
 * half-tick boundary. Fast and slow pets both play the complete anticipation
 * inside their own windup, instead of letting the clip outrun the battle. */
export function warfrontRigTrack(result: DuelResult, actorId: string): WarfrontRigTrack {
    const states = result.snapshots.map(snapshot => snapshot.actors.find(actor => actor.id === actorId)?.state);
    const track: WarfrontRigTrack = new Array(states.length).fill(null);
    for (let start = 0; start < states.length;) {
        let end = start + 1;
        while (end < states.length && states[end] === states[start]) end++;
        const state = states[start];
        if (state === "windup" || state === "strike" || state === "recover") {
            track.fill({ state, start: Math.max(0, start - .5), end: end - .5 }, start, end);
        }
        start = end;
    }
    return track;
}

export function warfrontRigPhase(track: WarfrontRigTrack, tick: number, motion: string): number | undefined {
    const phase = track[Math.max(0, Math.min(track.length - 1, Math.ceil(tick - .5)))];
    if (!phase || phase.state !== motion) return undefined;
    return Math.max(0, Math.min(1, (tick - phase.start) / Math.max(.5, phase.end - phase.start)));
}

/** Travel follows the path even with a live target. Casts and reactions plant
 * the feet and retain combat facing; this never changes simulation state. */
export function warfrontTravelFacing(moving: boolean, speed: number, state: string): boolean {
    return moving && speed > .05 && state !== "windup" && state !== "strike"
        && state !== "recover" && state !== "dodge" && state !== "stagger" && state !== "dead";
}

export const createWarfrontWeight = () => ({ vx: 0, vz: 0, pitch: 0, roll: 0 });

/** Bounded centre-of-mass lean, never a root translation. The replay clock
 * owns acceleration and settling, so pause/reduced motion cannot drift. */
export function stepWarfrontWeight(weight: ReturnType<typeof createWarfrontWeight>, vx: number, vz: number,
    dt: number, moving: boolean, reset = false): void {
    if (reset) { Object.assign(weight, { vx, vz, pitch: 0, roll: 0 }); return; }
    if (dt <= 0) return;
    const gain = 1 - Math.exp(-10 * Math.min(dt, .1));
    const x = moving ? (vx - weight.vx) / dt * .004 : 0;
    const z = moving ? (vz - weight.vz) / dt * .004 : 0;
    const limit = Math.min(1, .085 / Math.max(.001, Math.hypot(x, z)));
    weight.pitch += (z * limit - weight.pitch) * gain;
    weight.roll += (-x * limit - weight.roll) * gain;
    weight.vx = vx; weight.vz = vz;
}
