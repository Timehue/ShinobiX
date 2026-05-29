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
// Master bus: a gentle limiter so the stacked impact layers glue together and
// never clip into harsh digital crackle. Everything routes through this, not
// straight to the speakers.
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
            master.threshold.value = -10;
            master.knee.value = 24;
            master.ratio.value = 8;
            master.attack.value = 0.002;
            master.release.value = 0.2;
            master.connect(ctx.destination);
        }
        if (ctx.state === "suspended") void ctx.resume();
        return ctx;
    } catch {
        return null;
    }
}

// Route layers to the master bus (falls back to destination if unset).
function out(c: AudioContext): AudioNode { return master ?? c.destination; }

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
    preloadSamples(); // fetch + decode the recorded SFX up front
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
    osc.connect(g).connect(out(c));
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
    src.connect(f).connect(g).connect(out(c));
    src.start(t0);
    src.stop(t0 + dur + 0.02);
}

// ── Recorded-sample layer ────────────────────────────────────────────────
// Real .ogg/.mp3 files in public/sfx are fetched + decoded once on prime. If
// a kind has a decoded buffer we play that; otherwise we fall back to the
// synth below — so a missing/late file is never silent. `hit` has 5 variants
// chosen at random so rapid back-to-back hits don't sound machine-gunned.
const SAMPLE_SOURCES: Partial<Record<PetSfxKind, string[]>> = {
    hit:     ["/sfx/hit_1.ogg", "/sfx/hit_2.ogg", "/sfx/hit_3.ogg", "/sfx/hit_4.ogg", "/sfx/hit_5.ogg"],
    crit:    ["/sfx/crit.ogg"],
    ko:      ["/sfx/ko.mp3"],
    heal:    ["/sfx/heal.ogg"],
    buff:    ["/sfx/buff.ogg"],
    debuff:  ["/sfx/debuff.ogg"],
    dot:     ["/sfx/dot.ogg"],
    dodge:   ["/sfx/dodge.mp3"],
    shield:  ["/sfx/shield.mp3"],
    victory: ["/sfx/victory.ogg"],
};

// Per-kind playback gain — recorded files vary in inherent loudness, so each
// kind gets a level here. Tweak these to balance the mix.
const SAMPLE_GAIN: Partial<Record<PetSfxKind, number>> = {
    hit: 0.55, crit: 0.75, ko: 0.85, heal: 0.6, buff: 0.6,
    debuff: 0.6, dot: 0.5, dodge: 0.5, shield: 0.6, victory: 0.65,
};

const sampleBuffers = new Map<string, AudioBuffer>();
let samplesRequested = false;

async function loadSample(c: AudioContext, url: string): Promise<void> {
    if (sampleBuffers.has(url)) return;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const arr = await resp.arrayBuffer();
        const buf = await c.decodeAudioData(arr);
        sampleBuffers.set(url, buf);
    } catch { /* missing / undecodable → synth fallback handles it */ }
}

function preloadSamples(): void {
    const c = getCtx();
    if (!c || samplesRequested) return;
    samplesRequested = true;
    for (const urls of Object.values(SAMPLE_SOURCES)) {
        if (urls) for (const u of urls) void loadSample(c, u);
    }
}

// Play a decoded recorded sample for this kind. Returns true if one played
// (caller then skips the synth); false if no file is ready for this kind.
function playSample(c: AudioContext, kind: PetSfxKind): boolean {
    const urls = SAMPLE_SOURCES[kind];
    if (!urls) return false;
    const ready = urls.filter((u) => sampleBuffers.has(u));
    if (ready.length === 0) return false;
    const url = ready[Math.floor(Math.random() * ready.length)];
    const buf = sampleBuffers.get(url);
    if (!buf) return false;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = SAMPLE_GAIN[kind] ?? 0.6;
    src.connect(g).connect(out(c));
    src.start();
    return true;
}

export function playPetSfx(kind: PetSfxKind): void {
    if (isPetSfxMuted()) return;
    const c = getCtx();
    if (!c) return;
    // Prefer a recorded sample; fall through to the synth only if none loaded.
    if (playSample(c, kind)) return;
    try {
        switch (kind) {
            case "hit":
                // Real impacts = 3 layers stacked at t=0: a bright CLICK transient
                // (the "crack"), a pitched-down body THUMP, and a short low tail.
                // The transient is what your ear reads as "solid contact".
                noise(c, { dur: 0.035, gain: 0.5, type: "highpass", freq: 3500 });   // crack
                tone(c, { type: "triangle", from: 320, to: 70, dur: 0.13, gain: 0.4, attack: 0.001 }); // thump
                noise(c, { dur: 0.13, gain: 0.22, type: "lowpass", freq: 1400 });    // body
                tone(c, { type: "sine", from: 110, to: 45, dur: 0.18, gain: 0.32, attack: 0.001 });    // low tail
                break;
            case "crit":
                // Heavier, brighter, with a metallic ring + a deeper boom under it.
                noise(c, { dur: 0.05, gain: 0.6, type: "highpass", freq: 4000 });    // sharp crack
                tone(c, { type: "sawtooth", from: 420, to: 80, dur: 0.18, gain: 0.34, attack: 0.001 }); // aggressive body
                tone(c, { type: "square", from: 1300, to: 600, dur: 0.09, gain: 0.14 }); // metallic ring
                noise(c, { dur: 0.22, gain: 0.3, type: "lowpass", freq: 1100 });     // boom
                tone(c, { type: "sine", from: 90, to: 38, dur: 0.3, gain: 0.4, attack: 0.001 });        // deep tail
                break;
            case "ko":
                // Big cinematic boom: sharp crack → huge sub drop → long rumble tail.
                noise(c, { dur: 0.06, gain: 0.55, type: "highpass", freq: 3000 });
                tone(c, { type: "sine", from: 200, to: 32, dur: 0.6, gain: 0.5, attack: 0.001 });
                tone(c, { type: "sine", from: 80, to: 24, dur: 0.8, gain: 0.42, attack: 0.002 });
                noise(c, { dur: 0.55, gain: 0.32, type: "lowpass", freq: 700 });
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
