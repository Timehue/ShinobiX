// Battle music + the global audio master-mute.
//
// The authored track streams through HTMLAudioElement. Hollow Gate battles add
// a very quiet procedural spectral drone underneath it; phase changes alter the
// mix, pitch, and pressure without shipping another multi-megabyte audio file.

const MASTER_MUTE_KEY = "audioMuted";

const TRACKS = [
    "/music/silk-shuriken.ogg",
    "/music/silk-shuriken-2.ogg",
    "/music/koi-kunai.ogg",
];
const HOLLOW_GATE_TRACK = "/music/silk-shuriken-2.ogg";

export type BattleMusicTheme = "standard" | "hollow-gate";
export type BattleMusicIntensity = "calm" | "pressure" | "climax";

export function hollowGateMusicMix(intensity: BattleMusicIntensity): {
    musicVolume: number;
    playbackRate: number;
    droneGain: number;
    droneFrequency: number;
} {
    if (intensity === "climax") return { musicVolume: 0.46, playbackRate: 1.04, droneGain: 0.038, droneFrequency: 61 };
    if (intensity === "pressure") return { musicVolume: 0.42, playbackRate: 1, droneGain: 0.023, droneFrequency: 55 };
    return { musicVolume: 0.36, playbackRate: 0.97, droneGain: 0.011, droneFrequency: 49 };
}

export function standardBattleMusicMix(intensity: BattleMusicIntensity): {
    musicVolume: number;
    playbackRate: number;
} {
    if (intensity === "climax") return { musicVolume: 0.47, playbackRate: 1.035 };
    if (intensity === "pressure") return { musicVolume: 0.42, playbackRate: 1.012 };
    return { musicVolume: 0.36, playbackRate: 0.985 };
}

let audioEl: HTMLAudioElement | null = null;
let lastTrackIndex = -1;
let fadeTimer: number | null = null;
let currentTheme: BattleMusicTheme | null = null;
let currentIntensity: BattleMusicIntensity = "calm";
let hollowAudioContext: AudioContext | null = null;
let hollowDroneGain: GainNode | null = null;
let hollowDroneA: OscillatorNode | null = null;
let hollowDroneB: OscillatorNode | null = null;
let hollowDroneFilter: BiquadFilterNode | null = null;
let droneSuspendTimer: number | null = null;
let duckRestoreTimer: number | null = null;
const muteListeners = new Set<() => void>();

// Audio defaults to muted. Only an explicit "0" counts as unmuted.
export function isAudioMuted(): boolean {
    try { return localStorage.getItem(MASTER_MUTE_KEY) !== "0"; } catch { return true; }
}

export function setAudioMuted(muted: boolean): void {
    try { localStorage.setItem(MASTER_MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    if (audioEl) {
        if (muted) audioEl.pause();
        else if (audioEl.src) void audioEl.play().catch(() => {});
    }
    if (hollowAudioContext) {
        if (muted) void hollowAudioContext.suspend().catch(() => {});
        else if (currentTheme === "hollow-gate") void hollowAudioContext.resume().catch(() => {});
    }
    muteListeners.forEach((callback) => callback());
}

export function subscribeAudioMute(callback: () => void): () => void {
    muteListeners.add(callback);
    return () => { muteListeners.delete(callback); };
}

function ensureEl(): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    if (!audioEl) {
        audioEl = new Audio();
        audioEl.loop = true;
        audioEl.preload = "auto";
        audioEl.volume = 0.4;
    }
    return audioEl;
}

function clearFade(): void {
    if (fadeTimer !== null) {
        window.clearInterval(fadeTimer);
        fadeTimer = null;
    }
}

function ensureHollowDrone(): void {
    if (typeof window === "undefined" || hollowAudioContext) return;
    const AudioContextCtor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const oscillatorA = context.createOscillator();
    const oscillatorB = context.createOscillator();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    filter.Q.value = 1.4;
    gain.gain.value = 0;
    oscillatorA.type = "sine";
    oscillatorB.type = "triangle";
    oscillatorB.detune.value = 702;
    oscillatorA.connect(filter);
    oscillatorB.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    oscillatorA.start();
    oscillatorB.start();

    hollowAudioContext = context;
    hollowDroneFilter = filter;
    hollowDroneGain = gain;
    hollowDroneA = oscillatorA;
    hollowDroneB = oscillatorB;
}

function applyBattleMix(intensity: BattleMusicIntensity): void {
    const hollowMix = hollowGateMusicMix(intensity);
    const standardMix = standardBattleMusicMix(intensity);
    if (audioEl) {
        const mix = currentTheme === "hollow-gate" ? hollowMix : standardMix;
        audioEl.volume = mix.musicVolume;
        audioEl.playbackRate = mix.playbackRate;
    }
    const context = hollowAudioContext;
    if (!context || !hollowDroneGain || !hollowDroneA || !hollowDroneB || !hollowDroneFilter) return;
    const at = context.currentTime;
    hollowDroneGain.gain.cancelScheduledValues(at);
    hollowDroneGain.gain.setTargetAtTime(isAudioMuted() || currentTheme !== "hollow-gate" ? 0 : hollowMix.droneGain, at, 0.22);
    hollowDroneA.frequency.setTargetAtTime(hollowMix.droneFrequency, at, 0.35);
    hollowDroneB.frequency.setTargetAtTime(hollowMix.droneFrequency, at, 0.35);
    hollowDroneFilter.frequency.setTargetAtTime(170 + hollowMix.droneGain * 4_000, at, 0.3);
}

/** Shift the Hollow Gate score between exploration, danger, and Alpha climax. */
export function setBattleMusicIntensity(intensity: BattleMusicIntensity): void {
    currentIntensity = intensity;
    applyBattleMix(intensity);
}

/** Temporarily clear space in the score for an order, clash, or finishing hit. */
export function duckBattleMusic(level = 0.42, holdMs = 520): void {
    if (!audioEl || currentTheme === null || isAudioMuted()) return;
    if (duckRestoreTimer !== null) window.clearTimeout(duckRestoreTimer);
    const base = currentTheme === "hollow-gate"
        ? hollowGateMusicMix(currentIntensity).musicVolume
        : standardBattleMusicMix(currentIntensity).musicVolume;
    audioEl.volume = Math.max(0.04, base * Math.max(0.15, Math.min(1, level)));
    duckRestoreTimer = window.setTimeout(() => {
        duckRestoreTimer = null;
        applyBattleMix(currentIntensity);
    }, Math.max(80, holdMs));
}

/** Start (or restart) battle music from the same gesture that primes SFX. */
export function startBattleMusic(theme: BattleMusicTheme = "standard"): void {
    if (isAudioMuted()) return;
    const el = ensureEl();
    if (!el) return;
    clearFade();
    currentTheme = theme;

    if (theme === "hollow-gate") {
        el.src = HOLLOW_GATE_TRACK;
        ensureHollowDrone();
        if (droneSuspendTimer !== null) {
            window.clearTimeout(droneSuspendTimer);
            droneSuspendTimer = null;
        }
        if (hollowAudioContext) void hollowAudioContext.resume().catch(() => {});
    } else {
        let index = Math.floor(Math.random() * TRACKS.length);
        if (TRACKS.length > 1 && index === lastTrackIndex) index = (index + 1) % TRACKS.length;
        lastTrackIndex = index;
        el.src = TRACKS[index];
    }

    el.currentTime = 0;
    el.playbackRate = 1;
    applyBattleMix(currentIntensity);
    void el.play().catch(() => { /* autoplay requires a user gesture */ });
}

/** Fade out and stop the current score and Hollow Gate drone. */
export function stopBattleMusic(): void {
    const el = audioEl;
    if (!el) return;
    clearFade();
    if (duckRestoreTimer !== null) {
        window.clearTimeout(duckRestoreTimer);
        duckRestoreTimer = null;
    }
    currentTheme = null;

    if (hollowAudioContext && hollowDroneGain) {
        const at = hollowAudioContext.currentTime;
        hollowDroneGain.gain.cancelScheduledValues(at);
        hollowDroneGain.gain.setTargetAtTime(0, at, 0.12);
        if (droneSuspendTimer !== null) window.clearTimeout(droneSuspendTimer);
        droneSuspendTimer = window.setTimeout(() => {
            droneSuspendTimer = null;
            void hollowAudioContext?.suspend().catch(() => {});
        }, 650);
    }

    const startVolume = el.volume;
    const steps = 12;
    let step = 0;
    fadeTimer = window.setInterval(() => {
        step += 1;
        el.volume = Math.max(0, startVolume * (1 - step / steps));
        if (step >= steps) {
            clearFade();
            el.pause();
            el.currentTime = 0;
            el.playbackRate = 1;
            el.volume = startVolume;
        }
    }, 40);
}
