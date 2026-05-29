// Pet-battle sound effects — fully synthesized via the Web Audio API, so there
// are zero asset files to ship or load. One shared AudioContext is created
// lazily on first use (the "Start Battle" click counts as the unlocking user
// gesture). A localStorage flag lets players mute. Every call is
// fire-and-forget and swallows its own errors, so audio can never break a
// battle replay.

type PetSfxKind =
    | "hit" | "crit" | "ko" | "heal" | "buff" | "dot"
    | "debuff" | "movelock" | "dodge" | "shield" | "move" | "victory";

const MUTE_KEY = "petSfxMuted";
let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
        if (!ctx) {
            const AC = window.AudioContext
                ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === "suspended") void ctx.resume();
        return ctx;
    } catch {
        return null;
    }
}

export function isPetSfxMuted(): boolean {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function setPetSfxMuted(muted: boolean): void {
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
}

/** Resume/create the context up front — call from a click handler so the very
 *  first frame's sound isn't swallowed by the browser autoplay policy. */
export function primePetSfx(): void {
    if (isPetSfxMuted()) return;
    getCtx();
}

// A pitched envelope: oscillator with an optional exponential frequency sweep
// and a fast attack / exponential decay so it reads as a "blip" not a drone.
function tone(c: AudioContext, opts: {
    type?: OscillatorType; from: number; to?: number; dur: number;
    gain?: number; delay?: number; attack?: number;
}): void {
    const { type = "sine", from, to = from, dur, gain = 0.2, delay = 0, attack = 0.005 } = opts;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

function getNoise(c: AudioContext): AudioBuffer {
    if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
        const len = Math.floor(c.sampleRate * 0.5);
        noiseBuf = c.createBuffer(1, len, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
}

// A filtered noise burst — the "crunch" layer that gives impacts their texture.
function noise(c: AudioContext, opts: {
    dur: number; gain?: number; type?: BiquadFilterType; freq?: number; q?: number; delay?: number;
}): void {
    const { dur, gain = 0.2, type = "lowpass", freq = 1200, q = 0.7, delay = 0 } = opts;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
}

export function playPetSfx(kind: PetSfxKind): void {
    if (isPetSfxMuted()) return;
    const c = getCtx();
    if (!c) return;
    try {
        switch (kind) {
            case "hit":
                // Punchy thud: pitch-dropping body + a short low crunch.
                tone(c, { type: "sine", from: 170, to: 58, dur: 0.16, gain: 0.34 });
                noise(c, { dur: 0.10, gain: 0.18, type: "lowpass", freq: 2200 });
                break;
            case "crit":
                // Sharper, brighter, with a metallic high blip on top.
                tone(c, { type: "square", from: 230, to: 70, dur: 0.20, gain: 0.26 });
                tone(c, { type: "sine", from: 900, to: 320, dur: 0.12, gain: 0.16 });
                noise(c, { dur: 0.15, gain: 0.24, type: "highpass", freq: 1500 });
                break;
            case "ko":
                // Big, slow boom with a sub layer.
                tone(c, { type: "sine", from: 150, to: 40, dur: 0.55, gain: 0.42 });
                tone(c, { type: "sine", from: 72, to: 30, dur: 0.65, gain: 0.30 });
                noise(c, { dur: 0.45, gain: 0.30, type: "lowpass", freq: 900 });
                break;
            case "heal":
                tone(c, { type: "sine", from: 523, to: 784, dur: 0.30, gain: 0.20 });
                tone(c, { type: "sine", from: 659, dur: 0.28, gain: 0.13, delay: 0.07 });
                break;
            case "buff":
                tone(c, { type: "triangle", from: 440, dur: 0.12, gain: 0.18 });
                tone(c, { type: "triangle", from: 554, dur: 0.12, gain: 0.18, delay: 0.08 });
                tone(c, { type: "triangle", from: 659, dur: 0.16, gain: 0.18, delay: 0.16 });
                break;
            case "dot":
                noise(c, { dur: 0.24, gain: 0.16, type: "bandpass", freq: 1600, q: 1.2 });
                break;
            case "debuff":
                tone(c, { type: "sawtooth", from: 330, to: 120, dur: 0.28, gain: 0.15 });
                break;
            case "movelock":
                tone(c, { type: "square", from: 210, to: 90, dur: 0.22, gain: 0.17 });
                noise(c, { dur: 0.12, gain: 0.12, type: "bandpass", freq: 800, q: 2 });
                break;
            case "shield":
                tone(c, { type: "sine", from: 300, to: 620, dur: 0.18, gain: 0.18 });
                noise(c, { dur: 0.10, gain: 0.08, type: "highpass", freq: 3000 });
                break;
            case "move":
                noise(c, { dur: 0.16, gain: 0.07, type: "bandpass", freq: 1200, q: 0.8 });
                break;
            case "dodge":
                noise(c, { dur: 0.20, gain: 0.14, type: "highpass", freq: 1800 });
                break;
            case "victory":
                tone(c, { type: "triangle", from: 523, dur: 0.16, gain: 0.22 });
                tone(c, { type: "triangle", from: 659, dur: 0.16, gain: 0.22, delay: 0.14 });
                tone(c, { type: "triangle", from: 784, dur: 0.16, gain: 0.22, delay: 0.28 });
                tone(c, { type: "triangle", from: 1047, dur: 0.34, gain: 0.22, delay: 0.42 });
                break;
        }
    } catch {
        /* never let audio break the battle */
    }
}
