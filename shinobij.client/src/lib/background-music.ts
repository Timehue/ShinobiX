// Contextual world music. This owns the quiet exploration/combat score while
// preserving the Settings screen's one master mute and volume preference.

import {
    BATTLE_MUSIC_TRACKS,
    getAudioVolume,
    isAudioMuted,
    isBattleMusicActive,
    subscribeAudioMute,
    subscribeBattleMusic,
} from "./pet-music";
import { isAudioBackgrounded, subscribeAudioLifecycle } from "./audio-lifecycle";

export type BackgroundMusicScene = "village" | "combat" | null;

const VILLAGE_TRACKS = [
    "/music/world/wind-of-the-ninja-village.mp3",
    "/music/world/ninja-night.mp3",
    "/music/world/ninja-wind-melody.mp3",
    "/music/world/village-background-sj.mp3",
];
const TRACKS = { village: VILLAGE_TRACKS, combat: BATTLE_MUSIC_TRACKS };

// Keep the continuous score comfortably beneath UI feedback and combat SFX.
export const BACKGROUND_MUSIC_VOLUME = 0.18;

let audioEl: HTMLAudioElement | null = null;
let currentScene: BackgroundMusicScene = null;
const lastTrackIndex = { village: -1, combat: -1 };
let unsubscribeLifecycle: (() => void) | null = null;

function syncPlayback(): void {
    if (currentScene === null) {
        audioEl?.pause();
        if (audioEl) audioEl.currentTime = 0;
        return;
    }

    const el = ensureAudio();
    if (!el) return;
    // A pet battle, a dungeon fight or the Hollow Gate runs its own battle
    // score. The world score pauses under it rather than playing a second
    // track, then resumes where it stopped.
    const blocked = isAudioMuted() || isAudioBackgrounded() || isBattleMusicActive();
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
        const el = new Audio();
        audioEl = el;
        el.preload = "auto";
        el.onended = () => {
            if (currentScene === null || el.loop) return;
            el.src = trackFor(currentScene);
            el.currentTime = 0;
            syncPlayback();
        };
        unsubscribeLifecycle = subscribeAudioLifecycle(syncPlayback);
    }
    return audioEl;
}

function trackFor(scene: Exclude<BackgroundMusicScene, null>): string {
    const tracks = TRACKS[scene];
    let index = Math.floor(Math.random() * tracks.length);
    if (tracks.length > 1 && index === lastTrackIndex[scene]) index = (index + 1) % tracks.length;
    lastTrackIndex[scene] = index;
    return tracks[index];
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
    el.loop = TRACKS[scene].length === 1;
    el.src = trackFor(scene);
    el.currentTime = 0;
    syncPlayback();
}

// The player can unmute after a scene has already been selected.
const unsubscribeMute = subscribeAudioMute(syncPlayback);
const unsubscribeBattleMusic = subscribeBattleMusic(syncPlayback);

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        unsubscribeMute();
        unsubscribeBattleMusic();
        unsubscribeLifecycle?.();
        audioEl?.pause();
    });
}
