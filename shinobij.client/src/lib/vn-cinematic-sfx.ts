/*
 * Cinematic VN sound.
 *
 * Design rule: semantic and sparse. There is intentionally no sound for the
 * ordinary Next action or each typewriter character. A cue is allowed only
 * when the story direction marks a title, physical paper action, reveal, omen,
 * decision, or battle handoff. The patches favor short noise/transient shapes
 * and low wooden resonance over bright oscillator "UI beeps".
 *
 * Everything respects the game's one master mute, stays below the dialogue
 * reading experience, and fails closed: audio can never block story flow.
 */
import { isAudioMuted } from "./pet-music";
import type { VnSoundCue } from "../types/vn";

type VnAmbience = "none" | "village" | "road" | "interior" | "hollow";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: {
    kind: VnAmbience;
    gain: GainNode;
    sources: (AudioBufferSourceNode | OscillatorNode)[];
    nodes: AudioNode[];
} | null = null;

function audioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
        if (!context) {
            const AC = window.AudioContext
                ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) return null;
            context = new AC();
            const compressor = context.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 18;
            compressor.ratio.value = 5;
            compressor.attack.value = 0.004;
            compressor.release.value = 0.24;
            master = context.createGain();
            master.gain.value = 0.52;
            master.connect(compressor);
            compressor.connect(context.destination);
        }
        if (context.state === "suspended") void context.resume();
        return context;
    } catch {
        return null;
    }
}
function output(c: AudioContext): AudioNode {
    return master ?? c.destination;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
    const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.018 * white) / 1.018;
        data[i] = brown * 3.2;
    }
    return buffer;
}

function resonantTone(c: AudioContext, options: {
    from: number;
    to?: number;
    duration: number;
    gain: number;
    delay?: number;
    type?: OscillatorType;
    attack?: number;
}): void {
    const {
        from,
        to = from,
        duration,
        gain,
        delay = 0,
        type = "sine",
        attack = 0.008,
    } = options;
    const start = c.currentTime + delay;
    const oscillator = c.createOscillator();
    const envelope = c.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(output(c));
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
}

function filteredNoise(c: AudioContext, options: {
    duration: number;
    gain: number;
    frequency: number;
    type: BiquadFilterType;
    q?: number;
    delay?: number;
    attack?: number;
    endFrequency?: number;
}): void {
    const {
        duration,
        gain,
        frequency,
        type,
        q = 0.8,
        delay = 0,
        attack = 0.006,
        endFrequency,
    } = options;
    const start = c.currentTime + delay;
    const source = c.createBufferSource();
    source.buffer = noiseBuffer(c, duration + 0.1);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(output(c));
    source.start(start);
    source.stop(start + duration + 0.04);
}

export function playVnCue(cue: VnSoundCue): void {
    if (cue === "none" || isAudioMuted()) return;
    const c = audioContext();
    if (!c) return;
    try {
        switch (cue) {
            case "title":
                // One muted wooden strike with a short, non-melodic room tail.
                filteredNoise(c, { duration: 0.16, gain: 0.018, frequency: 520, type: "bandpass", q: 1.4 });
                resonantTone(c, { from: 146.8, duration: 1.25, gain: 0.026, attack: 0.004 });
                resonantTone(c, { from: 220, duration: 0.75, gain: 0.009, delay: 0.012 });
                break;
            case "paper":
                // A tiny quill/cedar texture, quieter than a normal UI click.
                filteredNoise(c, { duration: 0.11, gain: 0.011, frequency: 1850, type: "bandpass", q: 0.9 });
                filteredNoise(c, { duration: 0.08, gain: 0.006, frequency: 420, type: "highpass", delay: 0.045 });
                break;
            case "reveal":
                // Pressure gathers before the low fifth arrives; no sparkle scale.
                filteredNoise(c, {
                    duration: 0.92,
                    gain: 0.018,
                    frequency: 260,
                    endFrequency: 1450,
                    type: "bandpass",
                    q: 0.7,
                    attack: 0.52,
                });
                resonantTone(c, { from: 110, duration: 1.35, gain: 0.025, delay: 0.34, attack: 0.18 });
                resonantTone(c, { from: 164.8, duration: 1.05, gain: 0.012, delay: 0.4, attack: 0.14 });
                break;
            case "omen":
                // Low pressure, deliberately restrained so headphones do not get punished.
                filteredNoise(c, { duration: 1.3, gain: 0.022, frequency: 105, type: "lowpass", attack: 0.32 });
                resonantTone(c, { from: 48, to: 42, duration: 1.45, gain: 0.028, attack: 0.3 });
                break;
            case "decision":
                // A dry wooden settle: acknowledges a decision without rewarding it.
                filteredNoise(c, { duration: 0.12, gain: 0.016, frequency: 390, type: "bandpass", q: 1.8 });
                resonantTone(c, { from: 196, duration: 0.32, gain: 0.012, attack: 0.003 });
                break;
            case "battle":
                // Compact taiko-like body and skin transient, no arcade stinger.
                resonantTone(c, { from: 92, to: 46, duration: 0.58, gain: 0.052, attack: 0.003 });
                filteredNoise(c, { duration: 0.22, gain: 0.02, frequency: 760, type: "bandpass", q: 0.8 });
                resonantTone(c, { from: 138.6, duration: 0.72, gain: 0.014, delay: 0.08 });
                break;
        }
    } catch {
        // Sound is optional. Story flow is not.
    }
}

function buildAmbience(kind: Exclude<VnAmbience, "none">): void {
    const c = audioContext();
    if (!c || isAudioMuted()) return;
    const bed = c.createGain();
    bed.gain.setValueAtTime(0.0001, c.currentTime);
    bed.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.8);
    bed.connect(output(c));

    const source = c.createBufferSource();
    source.buffer = noiseBuffer(c, 2.8);
    source.loop = true;
    const filter = c.createBiquadFilter();
    const texture = c.createGain();
    filter.type = "lowpass";
    filter.frequency.value = kind === "road" ? 720 : kind === "hollow" ? 150 : kind === "interior" ? 360 : 520;
    texture.gain.value = kind === "hollow" ? 0.006 : kind === "interior" ? 0.009 : 0.008;
    source.connect(filter);
    filter.connect(texture);
    texture.connect(bed);
    source.start();

    const sources: (AudioBufferSourceNode | OscillatorNode)[] = [source];
    const nodes: AudioNode[] = [filter, texture];
    if (kind === "interior" || kind === "hollow") {
        const pad = c.createGain();
        pad.gain.value = kind === "hollow" ? 0.0025 : 0.0035;
        pad.connect(bed);
        const low = c.createOscillator();
        low.type = "sine";
        low.frequency.value = kind === "hollow" ? 55 : 87.3;
        const fifth = c.createOscillator();
        fifth.type = "sine";
        fifth.frequency.value = kind === "hollow" ? 82.4 : 130.8;
        low.connect(pad);
        fifth.connect(pad);
        low.start();
        fifth.start();
        sources.push(low, fifth);
        nodes.push(pad);
    }
    ambience = { kind, gain: bed, sources, nodes };
}

export function startVnAmbience(kind: VnAmbience): void {
    try {
        if (kind === "none" || isAudioMuted()) {
            stopVnAmbience(350);
            return;
        }
        if (ambience?.kind === kind) return;
        stopVnAmbience(450);
        buildAmbience(kind);
    } catch {
        // Optional audio.
    }
}

export function stopVnAmbience(fadeMs = 700): void {
    try {
        const active = ambience;
        if (!active) return;
        ambience = null;
        const c = context;
        if (!c) return;
        const now = c.currentTime;
        active.gain.gain.cancelScheduledValues(now);
        active.gain.gain.setValueAtTime(Math.max(0.0001, active.gain.gain.value), now);
        active.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeMs / 1000);
        window.setTimeout(() => {
            for (const source of active.sources) {
                try { source.stop(); } catch { /* already stopped */ }
                try { source.disconnect(); } catch { /* already disconnected */ }
            }
            for (const node of [...active.nodes, active.gain]) {
                try { node.disconnect(); } catch { /* already disconnected */ }
            }
        }, fadeMs + 80);
    } catch {
        // Optional audio.
    }
}
