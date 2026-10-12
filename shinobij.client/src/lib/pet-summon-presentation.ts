/** Beast Seal reinforcement cadence, shared by opening pet entrances. */
export const PET_SUMMON_SECONDS = 1.4;
export const PET_RECALL_SECONDS = .9;
export const PET_KO_HOLD_SECONDS = .9;

export type PetCardDirection = 'summon' | 'recall';
export type PetCardPhase = PetCardDirection | 'settled' | 'holding' | 'hidden';
export type PetCardPresence = { present: boolean; timeline?: number };
export type PetCardState = {
    phase: PetCardPhase;
    elapsed: number;
    present: boolean;
    timeline?: number;
    fromScale: number;
    fromLift: number;
};

/** The outgoing half of the existing switch seal, ending when its paper leaves. */
export function petRecallPose(progress: number) {
    const t = Math.max(0, Math.min(1, progress)) * .64;
    const draw = Math.max(0, Math.min(1, (t - .16) / .34));
    const ease = draw * draw * (3 - 2 * draw);
    return { scale: Math.max(.02, 1 - ease * .98), lift: ease * .5, visible: t < .52 };
}

/** Camera-facing paper pose in the same units as the Three.js switch effect. */
export function petCardSealPose(progress: number, direction: PetCardDirection) {
    const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
    const t = Math.max(0, Math.min(1, progress)) * (direction === 'recall' ? .64 : 1);
    if (direction === 'recall') {
        const arrive = smooth(t / .05), seal = smooth((t - .2) / .28), launch = smooth((t - .5) / .12), fold = smooth((t - .34) / .12);
        const scale = 1.65 * (1 - launch * .62) * (1 + Math.sin(t * 15) * .025);
        return { x: -1.15 * (1 - arrive), y: 3.35 + arrive * .55 + seal * .2 + launch * (1.6 + 2.5 * launch), width: scale * (1 - fold * .78), height: scale, rotation: -(.2 + arrive * .22 - launch * .5), opacity: smooth(t / .06) * (1 - smooth((t - .53) / .1)), glow: smooth(t / .11) * (1 - smooth((t - .42) / .1)) };
    }
    const flight = smooth((t - .17) / .28), release = smooth((t - .47) / .18);
    const glow = smooth((t - .47) / .08) * (1 - smooth((t - .69) / .08));
    const scale = 1.65 * (.92 + .12 * Math.sin(flight * Math.PI)) * (1 + glow * .28);
    return { x: 3.05 * (1 - flight), y: 3.9 + .2 * flight + Math.sin(flight * Math.PI) * .24, width: scale * (.22 + .78 * smooth((t - .33) / .14)), height: scale, rotation: .42 * (1 - flight) - release * .16, opacity: smooth((t - .17) / .07) * (1 - smooth((t - .69) / .07)), glow };
}

export function createPetCardState(present = true, summon = true): PetCardState {
    return { phase: present ? summon ? 'summon' : 'settled' : 'hidden', elapsed: 0, present, fromScale: 1, fromLift: 0 };
}

export function petCardStatePose(state: PetCardState) {
    if (state.phase === 'summon') return petSummonPose(state.elapsed);
    if (state.phase === 'recall') {
        const pose = petRecallPose(state.elapsed / PET_RECALL_SECONDS);
        return { scale: pose.scale * state.fromScale, lift: state.fromLift + pose.lift, visible: pose.visible && state.fromScale > 0 };
    }
    if (state.phase === 'holding') return { scale: state.fromScale, lift: state.fromLift, visible: state.fromScale > 0 };
    return { scale: state.phase === 'hidden' ? 0 : 1, lift: 0, visible: state.phase !== 'hidden' };
}

/** Presentation only: callers retain their actor and supply its authoritative presence.
 * Host timelines pause and rewind with playback; standalone scenes use frame delta. */
export function advancePetCardState(state: PetCardState, input: PetCardPresence, delta: number, recallDelay = 0, reduced = false): void {
    const rewound = input.timeline !== undefined && state.timeline !== undefined && input.timeline < state.timeline - .001;
    let step = input.timeline === undefined || state.timeline === undefined ? delta : Math.max(0, input.timeline - state.timeline);
    state.timeline = input.timeline;
    if (rewound) {
        Object.assign(state, createPetCardState(input.present, !reduced), { timeline: input.timeline });
        step = 0;
    }
    if (reduced) {
        state.phase = input.present ? 'settled' : 'hidden';
        state.present = input.present;
        state.elapsed = 0;
        return;
    }
    if (input.present !== state.present) {
        const pose = petCardStatePose(state);
        state.present = input.present;
        state.elapsed = 0;
        if (input.present) state.phase = 'summon';
        else {
            state.fromScale = pose.visible ? pose.scale : 0;
            state.fromLift = pose.lift;
            state.phase = recallDelay > 0 ? 'holding' : 'recall';
        }
    }
    // A scene departure skips a KO hold, then plays a fresh complete recall.
    if (state.phase === 'holding' && recallDelay === 0) {
        state.phase = 'recall';
        state.elapsed = 0;
    }
    state.elapsed += Math.max(0, step);
    if (state.phase === 'holding' && state.elapsed >= recallDelay) {
        state.elapsed -= recallDelay;
        state.phase = 'recall';
    }
    if (state.phase === 'summon' && state.elapsed >= PET_SUMMON_SECONDS) state.phase = 'settled';
    if (state.phase === 'recall' && state.elapsed >= PET_RECALL_SECONDS) state.phase = 'hidden';
}

export function petSummonPose(seconds: number) {
    const p = Math.max(0, Math.min(1, seconds / PET_SUMMON_SECONDS));
    const release = Math.max(0, Math.min(1, (p - .49) / .19));
    const ease = release * release * (3 - 2 * release);
    return {
        scale: Math.max(.02, ease),
        lift: .56 * (1 - ease) + Math.sin(Math.PI * ease) * .24,
        visible: p >= .49,
    };
}
