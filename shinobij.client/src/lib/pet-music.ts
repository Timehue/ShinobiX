// Battle music + the global audio master-mute.
//
// Authored battle tracks stream through one HTMLAudioElement. Phase changes
// alter only the score mix and playback pressure; sound design lives in the
// shared sample engine rather than a procedural oscillator layer.

import { musicDeliverySrc } from "./audio-delivery";
import { isAudioBackgrounded, subscribeAudioLifecycle } from "./audio-lifecycle";

const MASTER_MUTE_KEY = "audioMuted";
const MASTER_VOLUME_KEY = "audioVolume.v1";

const TRACKS = [
    "/music/silk-shuriken.ogg",
    "/music/silk-shuriken-2.ogg",
    "/music/koi-kunai.ogg",
];
const HOLLOW_GATE_TRACK = "/music/silk-shuriken-2.ogg";
/** Pet Showdown's OWN theme. The flagship mode used to draw from the shared
 *  three-track pool, so the headline battle sounded like every other fight in
 *  the game. Commissioned for the mode (see docs/pet-showdown-design.md for the
 *  generator and the exact prompt). */
const SHOWDOWN_TRACK = "/music/showdown-lantern-duel.mp3";

export type BattleMusicTheme = "standard" | "hollow-gate" | "showdown";
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
let battleVolume = 0.4;
let fadeTimer: number | null = null;
let currentTheme: BattleMusicTheme | null = null;
let currentIntensity: BattleMusicIntensity = "calm";
let duckRestoreTimer: number | null = null;
const muteListeners = new Set<() => void>();
let unsubscribeLifecycle: (() => void) | null = null;

function syncBattlePlayback(): void {
    if (!audioEl) return;
    const blocked = isAudioMuted() || isAudioBackgrounded();
    audioEl.muted = blocked;
    if (blocked) {
        clearFade();
        if (duckRestoreTimer !== null) {
            window.clearTimeout(duckRestoreTimer);
            duckRestoreTimer = null;
        }
        audioEl.pause();
    } else if (currentTheme !== null && audioEl.src) {
        applyBattleMix(currentIntensity);
        void audioEl.play().catch(() => {});
    }
}

// Audio defaults to muted. Only an explicit "0" counts as unmuted.
export function isAudioMuted(): boolean {
    try { return localStorage.getItem(MASTER_MUTE_KEY) !== "0"; } catch { return true; }
}

function notifyMuteListeners(): void {
    for (const callback of muteListeners) {
        try {
            callback();
        } catch {
            // One optional audio subsystem must never prevent the remaining
            // subscribers from honoring the master switch.
        }
    }
}

export function setAudioMuted(muted: boolean): void {
    try { localStorage.setItem(MASTER_MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    syncBattlePlayback();
    notifyMuteListeners();
}

export function getAudioVolume(): number {
    try {
        const saved = localStorage.getItem(MASTER_VOLUME_KEY);
        const value = saved === null ? 1 : Number(saved);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    } catch { return 1; }
}

export function setAudioVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    try { localStorage.setItem(MASTER_VOLUME_KEY, String(Math.max(0, Math.min(1, value)))); } catch { /* private mode */ }
    if (audioEl) audioEl.volume = battleVolume * getAudioVolume();
    notifyMuteListeners();
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
        audioEl.volume = 0.4 * getAudioVolume();
        audioEl.muted = isAudioMuted() || isAudioBackgrounded();
        unsubscribeLifecycle = subscribeAudioLifecycle(syncBattlePlayback);
    }
    return audioEl;
}

function clearFade(): void {
    if (fadeTimer !== null) {
        window.clearInterval(fadeTimer);
        fadeTimer = null;
    }
}

function applyBattleMix(intensity: BattleMusicIntensity): void {
    const hollowMix = hollowGateMusicMix(intensity);
    const standardMix = standardBattleMusicMix(intensity);
    if (audioEl) {
        const mix = currentTheme === "hollow-gate" ? hollowMix : standardMix;
        battleVolume = mix.musicVolume;
        audioEl.volume = battleVolume * getAudioVolume();
        audioEl.playbackRate = mix.playbackRate;
    }
}

/** Shift the Hollow Gate score between exploration, danger, and Alpha climax. */
export function setBattleMusicIntensity(intensity: BattleMusicIntensity): void {
    currentIntensity = intensity;
    applyBattleMix(intensity);
}

/** Temporarily clear space in the score for an order, clash, or finishing hit. */
export function duckBattleMusic(level = 0.42, holdMs = 520): void {
    if (!audioEl || currentTheme === null || isAudioMuted() || isAudioBackgrounded()) return;
    if (duckRestoreTimer !== null) window.clearTimeout(duckRestoreTimer);
    const base = currentTheme === "hollow-gate"
        ? hollowGateMusicMix(currentIntensity).musicVolume
        : standardBattleMusicMix(currentIntensity).musicVolume;
    battleVolume = Math.max(0.04, base * Math.max(0.15, Math.min(1, level)));
    audioEl.volume = battleVolume * getAudioVolume();
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

    // musicDeliverySrc redirects .ogg to its .m4a sibling on WebKit, which
    // decodes no Ogg container — battle music was silent on Safari/iOS. The
    // .mp3 showdown theme passes through untouched; it already plays everywhere.
    if (theme === "hollow-gate") {
        el.src = musicDeliverySrc(HOLLOW_GATE_TRACK);
    } else if (theme === "showdown") {
        el.src = musicDeliverySrc(SHOWDOWN_TRACK);
    } else {
        let index = Math.floor(Math.random() * TRACKS.length);
        if (TRACKS.length > 1 && index === lastTrackIndex) index = (index + 1) % TRACKS.length;
        lastTrackIndex = index;
        el.src = musicDeliverySrc(TRACKS[index]);
    }

    el.currentTime = 0;
    el.playbackRate = 1;
    applyBattleMix(currentIntensity);
    syncBattlePlayback();
}

/** Fade out and stop the current score. */
export function stopBattleMusic(): void {
    const el = audioEl;
    if (!el) return;
    clearFade();
    if (duckRestoreTimer !== null) {
        window.clearTimeout(duckRestoreTimer);
        duckRestoreTimer = null;
    }
    currentTheme = null;

    if (isAudioMuted() || isAudioBackgrounded()) {
        el.pause();
        el.currentTime = 0;
        el.playbackRate = 1;
        return;
    }

    const startVolume = battleVolume;
    const steps = 12;
    let step = 0;
    fadeTimer = window.setInterval(() => {
        step += 1;
        battleVolume = Math.max(0, startVolume * (1 - step / steps));
        el.volume = battleVolume * getAudioVolume();
        if (step >= steps) {
            clearFade();
            el.pause();
            el.currentTime = 0;
            el.playbackRate = 1;
            battleVolume = startVolume;
            el.volume = battleVolume * getAudioVolume();
        }
    }, 40);
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        unsubscribeLifecycle?.();
        clearFade();
        if (duckRestoreTimer !== null) window.clearTimeout(duckRestoreTimer);
        audioEl?.pause();
    });
}
