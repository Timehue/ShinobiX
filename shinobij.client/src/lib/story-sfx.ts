// Story-fight audio cues — fully synthesized via the Web Audio API in the same
// zero-asset style as lib/pet-sfx.ts. One lazy shared AudioContext (the fight
// launch click is the unlocking gesture), everything routed through a gentle
// limiter, every call fire-and-forget so audio can never break a fight.
// Respects the global master mute (button next to Hide Menu).

import { isAudioMuted } from "./pet-music";

let ctx: AudioContext | null = null;
let master: DynamicsCompressorNode | null = null;

function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
        if (!ctx) {
            const AC = window.AudioContext
                ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            master = ctx.createDynamicsCompressor();
            master.threshold.value = -12;
            master.knee.value = 24;
            master.ratio.value = 8;
            master.attack.value = 0.002;
            master.release.value = 0.25;
            master.connect(ctx.destination);
        }
        if (ctx.state === "suspended") void ctx.resume();
        return ctx;
    } catch {
        return null;
    }
}

function note(
    c: AudioContext,
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    peak: number,
): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(master ?? c.destination);
    osc.start(at);
    osc.stop(at + dur + 0.05);
}

// Each village gets a short signature motif (~1.1s) played once as the sealed
// chapter fight opens: [frequency, startOffset, duration, waveform, peak][].
type Motif = Array<[number, number, number, OscillatorType, number]>;
const VILLAGE_MOTIFS: Record<string, Motif> = {
    // Stormveil — rising perfect fourth over a warm root: resolve, then rain.
    "Stormveil Village": [
        [196, 0, 0.5, "triangle", 0.16], [261.6, 0.18, 0.5, "triangle", 0.16], [392, 0.38, 0.7, "sine", 0.14],
    ],
    // Ashen Leaf — low ember rumble into a minor-third flare.
    "Ashen Leaf Village": [
        [98, 0, 0.75, "sawtooth", 0.1], [116.5, 0.3, 0.55, "sawtooth", 0.09], [233, 0.55, 0.55, "triangle", 0.13],
    ],
    // Frostfang — icy high bells, detuned shimmer.
    "Frostfang Village": [
        [1046.5, 0, 0.6, "sine", 0.09], [1051, 0.03, 0.6, "sine", 0.06], [784, 0.32, 0.75, "sine", 0.11],
    ],
    // Moonshadow — a hollow tritone question in the dark.
    "Moonshadow Village": [
        [220, 0, 0.6, "square", 0.055], [311.1, 0.3, 0.65, "square", 0.05], [440, 0.62, 0.6, "sine", 0.08],
    ],
};

function playMotif(motif: Motif): void {
    if (isAudioMuted()) return;
    const c = getCtx();
    if (!c) return;
    try {
        const now = c.currentTime + 0.02;
        for (const [freq, at, dur, type, peak] of motif) note(c, freq, now + at, dur, type, peak);
    } catch { /* audio must never break a fight */ }
}

/** Chapter opening sting, keyed by village (silent for unknown villages). */
export function playStoryChapterSting(village: string | undefined): void {
    const motif = village ? VILLAGE_MOTIFS[village] : undefined;
    if (motif) playMotif(motif);
}

/** Final-phase riser — the boss crosses its last-stand threshold. */
export function playStoryFinalPhaseSting(): void {
    if (isAudioMuted()) return;
    const c = getCtx();
    if (!c) return;
    try {
        const now = c.currentTime + 0.02;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(233, now + 0.8);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.09, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
        osc.connect(gain);
        gain.connect(master ?? c.destination);
        osc.start(now);
        osc.stop(now + 1);
        note(c, 466.2, now + 0.55, 0.45, "triangle", 0.08);
    } catch { /* ignore */ }
}

/** Chapter-complete flourish — a small rising major arpeggio. */
export function playStoryVictorySting(): void {
    if (isAudioMuted()) return;
    const c = getCtx();
    if (!c) return;
    try {
        const now = c.currentTime + 0.02;
        const steps: Motif = [
            [392, 0, 0.35, "triangle", 0.13], [493.9, 0.14, 0.35, "triangle", 0.13],
            [587.3, 0.28, 0.4, "triangle", 0.13], [784, 0.45, 0.85, "sine", 0.15],
        ];
        for (const [freq, at, dur, type, peak] of steps) note(c, freq, now + at, dur, type, peak);
    } catch { /* ignore */ }
}
