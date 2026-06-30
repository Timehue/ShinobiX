// Pet-battle background music + the global audio master-mute.
//
// Music uses a single looping <audio> element (HTMLAudioElement streams the
// file — far lighter than decoding minutes of PCM through Web Audio). One
// track is chosen per battle, never repeating the track that just played, so
// back-to-back battles always sound different.
//
// The master mute here is the ONE global switch (the button next to "Hide
// Menu"): when muted, BOTH music and SFX go silent. pet-sfx.ts imports
// isAudioMuted() so it honours the same switch. Persisted to localStorage so
// the choice survives reloads.

const MASTER_MUTE_KEY = "audioMuted";

const TRACKS = [
    "/music/silk-shuriken.ogg",
    "/music/silk-shuriken-2.ogg",
    "/music/koi-kunai.ogg",
];

let audioEl: HTMLAudioElement | null = null;
let lastTrackIndex = -1;
let fadeTimer: number | null = null;
// Listeners so the toggle button re-renders when mute flips.
const muteListeners = new Set<() => void>();

// Audio defaults to MUTED (opt-in): a lot of players dislike game sound, so we
// stay silent until someone explicitly unmutes (which writes "0"). Only an
// explicit "0" counts as unmuted; missing key or "1" → muted.
export function isAudioMuted(): boolean {
    try { return localStorage.getItem(MASTER_MUTE_KEY) !== "0"; } catch { return true; }
}

export function setAudioMuted(muted: boolean): void {
    try { localStorage.setItem(MASTER_MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
    // Immediately reflect on any playing music.
    if (audioEl) {
        if (muted) audioEl.pause();
        else if (audioEl.src) void audioEl.play().catch(() => {});
    }
    muteListeners.forEach((cb) => cb());
}

export function subscribeAudioMute(cb: () => void): () => void {
    muteListeners.add(cb);
    return () => { muteListeners.delete(cb); };
}

function ensureEl(): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    if (!audioEl) {
        audioEl = new Audio();
        audioEl.loop = true;
        audioEl.preload = "auto";
        audioEl.volume = 0.4; // battle music sits under the SFX
    }
    return audioEl;
}

function clearFade(): void {
    if (fadeTimer !== null) { window.clearInterval(fadeTimer); fadeTimer = null; }
}

/** Start (or restart) battle music with a fresh track. Call when a battle
 *  begins — from the same click that primes SFX, so autoplay is unlocked. */
export function startBattleMusic(): void {
    if (isAudioMuted()) return;
    const el = ensureEl();
    if (!el) return;
    clearFade();
    // Pick a track that isn't the one we just played (when we have ≥2).
    let idx = Math.floor(Math.random() * TRACKS.length);
    if (TRACKS.length > 1 && idx === lastTrackIndex) idx = (idx + 1) % TRACKS.length;
    lastTrackIndex = idx;
    el.src = TRACKS[idx];
    el.currentTime = 0;
    el.volume = 0.4;
    void el.play().catch(() => { /* autoplay blocked — needs a user gesture */ });
}

/** Fade out + stop the music. Call when a battle ends or the screen exits. */
export function stopBattleMusic(): void {
    const el = audioEl;
    if (!el) return;
    clearFade();
    const startVol = el.volume;
    const steps = 12;
    let i = 0;
    fadeTimer = window.setInterval(() => {
        i += 1;
        el.volume = Math.max(0, startVol * (1 - i / steps));
        if (i >= steps) {
            clearFade();
            el.pause();
            el.currentTime = 0;
            el.volume = startVol;
        }
    }, 40);
}
