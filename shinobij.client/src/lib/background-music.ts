// Contextual world music. This owns the quiet exploration/combat score while
// preserving the Settings screen's one master mute and volume preference.

import { getAudioVolume, isAudioMuted, subscribeAudioMute } from "./pet-music";
import { isAudioBackgrounded, subscribeAudioLifecycle } from "./audio-lifecycle";

export type BackgroundMusicScene = "village" | "sector" | "combat" | null;

const VILLAGE_TRACKS = [
    "/music/world/wind-of-the-ninja-village.mp3",
    "/music/world/ninja-night.mp3",
];
const SECTOR_TRACK = "/music/world/ninja-wind-melody.mp3";
const COMBAT_TRACK = "/music/world/wind-blade-jutsu.mp3";

// Keep the continuous score comfortably beneath UI feedback and combat SFX.
export const BACKGROUND_MUSIC_VOLUME = 0.18;

let audioEl: HTMLAudioElement | null = null;
let currentScene: BackgroundMusicScene = null;
let lastVillageTrack = -1;
let unsubscribeLifecycle: (() => void) | null = null;

function syncPlayback(): void {
    if (currentScene === null) {
        audioEl?.pause();
        if (audioEl) audioEl.currentTime = 0;
        return;
    }

    const el = ensureAudio();
    if (!el) return;
    const blocked = isAudioMuted() || isAudioBackgrounded();
    el.muted = blocked;
    el.volume = BACKGROUND_MUSIC_VOLUME * getAudioVolume();
    if (blocked) {
        el.pause();
    } else {
        void el.play().catch(() => {
            // Autoplay policies may require the player to unmute from Settings
            // or interact with the game once; audio must never block gameplay.
        });
    }
}

function ensureAudio(): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    if (!audioEl) {
        audioEl = new Audio();
        audioEl.loop = true;
        audioEl.preload = "auto";
        unsubscribeLifecycle = subscribeAudioLifecycle(syncPlayback);
    }
    return audioEl;
}

function trackFor(scene: Exclude<BackgroundMusicScene, null>): string {
    if (scene === "combat") return COMBAT_TRACK;
    if (scene === "sector") return SECTOR_TRACK;
    let index = Math.floor(Math.random() * VILLAGE_TRACKS.length);
    if (VILLAGE_TRACKS.length > 1 && index === lastVillageTrack) index = (index + 1) % VILLAGE_TRACKS.length;
    lastVillageTrack = index;
    return VILLAGE_TRACKS[index];
}

/** Select the score for the player's actual location or active battle. */
export function setBackgroundMusicScene(scene: BackgroundMusicScene): void {
    if (scene === currentScene && (scene === null || audioEl?.src)) return;
    currentScene = scene;
    if (scene === null) {
        syncPlayback();
        return;
    }

    const el = ensureAudio();
    if (!el) return;
    el.src = trackFor(scene);
    el.currentTime = 0;
    syncPlayback();
}

// The player can unmute after a scene has already been selected.
const unsubscribeMute = subscribeAudioMute(syncPlayback);

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        unsubscribeMute();
        unsubscribeLifecycle?.();
        audioEl?.pause();
    });
}
