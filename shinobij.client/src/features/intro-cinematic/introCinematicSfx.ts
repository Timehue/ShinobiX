/*
 * Intro-cinematic audio — fully synthesized via Web Audio (zero asset files),
 * mirroring lib/pet-sfx.ts's approach. Honours the game's ONE master mute
 * (lib/pet-music isAudioMuted — audio is opt-in, default muted), swallows its
 * own errors, and is safe to call from anywhere: sound can never break the
 * cinematic.
 *
 * Two layers:
 *   - a looping shrine AMBIENCE bed (filtered-noise waterfall wash + a soft
 *     detuned drone pad + occasional pentatonic wind-chime plinks), started on
 *     the summon beat and faded out at the white-out, and
 *   - one-shot BEAT cues (advance tick, title gong, omen drone, gift sparkle,
 *     white-out shimmer) fired from the component's beat transitions.
 *
 * The AudioContext is created lazily from a click handler (the player clicks
 * to advance dialogue constantly), so the browser autoplay policy never
 * swallows the bed for long.
 */
import { isAudioMuted } from "../../lib/pet-music";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
        if (!ctx) {
            const AC = window.AudioContext
                ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 1;
            master.connect(ctx.destination);
        }
        if (ctx.state === "suspended") void ctx.resume();
        return ctx;
    } catch {
        return null;
    }
}

function bus(c: AudioContext): AudioNode { return master ?? c.destination; }

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
}

function tone(c: AudioContext, opts: {
    type?: OscillatorType; from: number; to?: number; dur: number;
    gain?: number; delay?: number; attack?: number;
}): void {
    const { type = "sine", from, to = from, dur, gain = 0.08, delay = 0, attack = 0.008 } = opts;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus(c));
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
}

// ── Ambience bed ─────────────────────────────────────────────────────────────

type Ambience = {
    gain: GainNode;
    nodes: AudioNode[];
    sources: (AudioBufferSourceNode | OscillatorNode)[];
    chimeTimer: number;
};
let ambience: Ambience | null = null;

// Pentatonic chime pool (A minor pentatonic, airy octaves).
const CHIME_NOTES = [440, 523.25, 587.33, 659.25, 880, 1046.5];

/** Start the shrine ambience (no-op when muted or already running). */
export function startIntroAmbience(): void {
    try {
        if (isAudioMuted() || ambience) return;
        const c = getCtx();
        if (!c) return;

        const bed = c.createGain();
        bed.gain.setValueAtTime(0.0001, c.currentTime);
        bed.gain.exponentialRampToValueAtTime(1, c.currentTime + 2.5); // slow fade-in
        bed.connect(bus(c));

        // Waterfall wash: looped noise through a dark lowpass.
        const noise = c.createBufferSource();
        noise.buffer = noiseBuffer(c, 2.4);
        noise.loop = true;
        const nFilter = c.createBiquadFilter();
        nFilter.type = "lowpass";
        nFilter.frequency.value = 420;
        const nGain = c.createGain();
        nGain.gain.value = 0.035;
        noise.connect(nFilter); nFilter.connect(nGain); nGain.connect(bed);
        noise.start();

        // Spirit pad: two slow detuned sines under a lowpass.
        const padGain = c.createGain();
        padGain.gain.value = 0.02;
        const pFilter = c.createBiquadFilter();
        pFilter.type = "lowpass";
        pFilter.frequency.value = 700;
        pFilter.connect(padGain); padGain.connect(bed);
        const oscA = c.createOscillator();
        oscA.frequency.value = 110;
        const oscB = c.createOscillator();
        oscB.frequency.value = 165.2; // a slightly sharp fifth — gentle shimmer beat
        oscA.connect(pFilter); oscB.connect(pFilter);
        oscA.start(); oscB.start();

        // Occasional wind-chime plinks.
        const chimeTimer = window.setInterval(() => {
            try {
                if (isAudioMuted() || !ambience) return;
                const note = CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)];
                tone(c, { from: note, dur: 2.2, gain: 0.03, attack: 0.004 });
                if (Math.random() < 0.4) {
                    tone(c, { from: note * 1.5, dur: 1.8, gain: 0.018, delay: 0.22 });
                }
            } catch { /* never break the cinematic */ }
        }, 7000);

        ambience = { gain: bed, nodes: [nFilter, nGain, pFilter, padGain], sources: [noise, oscA, oscB], chimeTimer };
    } catch { /* ignore */ }
}

/** Fade out and tear down the ambience bed. Safe to call repeatedly. */
export function stopIntroAmbience(fadeMs = 1000): void {
    try {
        const amb = ambience;
        if (!amb) return;
        ambience = null;
        window.clearInterval(amb.chimeTimer);
        const c = ctx;
        if (!c) return;
        const t = c.currentTime;
        amb.gain.gain.cancelScheduledValues(t);
        amb.gain.gain.setValueAtTime(Math.max(0.0001, amb.gain.gain.value), t);
        amb.gain.gain.exponentialRampToValueAtTime(0.0001, t + fadeMs / 1000);
        window.setTimeout(() => {
            try {
                amb.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
                [...amb.sources, ...amb.nodes, amb.gain].forEach((n) => { try { n.disconnect(); } catch { /* ok */ } });
            } catch { /* ignore */ }
        }, fadeMs + 120);
    } catch { /* ignore */ }
}

// ── One-shot beat cues ───────────────────────────────────────────────────────

export type IntroCue =
    | "advance"   // dialogue advanced — tiny paper tick
    | "title"     // title card — soft temple gong
    | "reveal"    // the fox names itself — chime arpeggio
    | "omen"      // Hollow Gate rumble line — sub swell + dark drone
    | "confirm"   // companion chosen — warm sparkle
    | "whiteout"; // departure — rising shimmer wash

export function introCue(kind: IntroCue): void {
    try {
        if (isAudioMuted()) return;
        const c = getCtx();
        if (!c) return;
        switch (kind) {
            case "advance":
                tone(c, { type: "triangle", from: 1180, to: 880, dur: 0.06, gain: 0.025 });
                break;
            case "title":
                tone(c, { from: 196, to: 194, dur: 3.2, gain: 0.05, attack: 0.01 });
                tone(c, { from: 392, dur: 2.4, gain: 0.025, delay: 0.02 });
                tone(c, { from: 588, dur: 1.6, gain: 0.012, delay: 0.05 });
                break;
            case "reveal":
                [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                    tone(c, { from: f, dur: 1.4, gain: 0.035, delay: i * 0.09 }));
                break;
            case "omen": {
                // Sub swell + a dark detuned drone under the rumble.
                tone(c, { from: 42, to: 36, dur: 2.6, gain: 0.16, attack: 0.4 });
                tone(c, { type: "sawtooth", from: 55, to: 52, dur: 2.4, gain: 0.02, attack: 0.5 });
                const rumble = c.createBufferSource();
                rumble.buffer = noiseBuffer(c, 1.2);
                rumble.loop = true;
                const f = c.createBiquadFilter();
                f.type = "lowpass";
                f.frequency.value = 120;
                const g = c.createGain();
                const t0 = c.currentTime;
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.5);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
                rumble.connect(f); f.connect(g); g.connect(bus(c));
                rumble.start(t0);
                rumble.stop(t0 + 2.6);
                break;
            }
            case "confirm":
                [659.25, 783.99, 987.77, 1318.5].forEach((f, i) =>
                    tone(c, { from: f, dur: 0.9, gain: 0.04, delay: i * 0.07 }));
                break;
            case "whiteout": {
                tone(c, { from: 440, to: 1760, dur: 1.6, gain: 0.04, attack: 0.3 });
                tone(c, { from: 554.37, to: 2217.5, dur: 1.6, gain: 0.025, attack: 0.35, delay: 0.05 });
                const wash = c.createBufferSource();
                wash.buffer = noiseBuffer(c, 1.4);
                const f = c.createBiquadFilter();
                f.type = "highpass";
                f.frequency.value = 1200;
                const g = c.createGain();
                const t0 = c.currentTime;
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(0.05, t0 + 1.1);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
                wash.connect(f); f.connect(g); g.connect(bus(c));
                wash.start(t0);
                wash.stop(t0 + 2.3);
                break;
            }
        }
    } catch { /* sound must never break the cinematic */ }
}
