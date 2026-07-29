/*
 * Story score playback.
 *
 * The visual novel owns a pair of looping HTMLAudioElements so chapter changes
 * can crossfade instead of hard-cutting. Music remains deliberately quiet under
 * dialogue, follows the game's master mute, and retries harmlessly on the next
 * player gesture when browser autoplay policy blocks the initial request.
 */
import { isAudioMuted, subscribeAudioMute } from "./pet-music";
import type { VnSoundCue } from "../types/vn";

export type VnScoreKey = "stormveil" | "ashen" | "frostfang" | "moonshadow" | "hollow";

export const VN_SCORE_TRACKS: Readonly<Record<VnScoreKey, string>> = {
    stormveil: "/music/vn/stormveil-reasons-in-rain.ogg",
    ashen: "/music/vn/ashen-future-in-fire.ogg",
    frostfang: "/music/vn/frostfang-warmth-we-keep.ogg",
    moonshadow: "/music/vn/moonshadow-name-under-glass.ogg",
    hollow: "/music/vn/hollow-gate-four-debts.ogg",
};

const BASE_VOLUME = 0.18;
const CROSSFADE_MS = 1_250;

let decks: [HTMLAudioElement, HTMLAudioElement] | null = null;
let activeDeck = 0;
let currentKey: VnScoreKey | null = null;
let mix: [number, number] = [0, 0];
let mixFrame: number | null = null;
let duckFrame: number | null = null;
let duckMultiplier = 1;
let listenersInstalled = false;

function normalized(value: string): string {
    return value.toLowerCase().replace(/[_\s]+/g, "-");
}

/** Select only authored village-story music; unrelated VN events stay silent. */
export function resolveVnScoreKey(eventId: string, eventLabel = ""): VnScoreKey | null {
    const normalizedId = normalized(eventId);
    const normalizedLabel = normalized(eventLabel);
    const haystack = `${normalizedId} ${normalizedLabel}`;
    const isStory = normalizedId.startsWith("story-") || normalizedLabel.includes("storyline");
    if (!isStory) return null;
    if (/(?:^|-)100(?:-|$)/.test(normalizedId) || haystack.includes("hollow-gate")) return "hollow";
    if (haystack.includes("stormveil")) return "stormveil";
    if (haystack.includes("ashen-leaf") || haystack.includes("ashen-village")) return "ashen";
    if (haystack.includes("frostfang")) return "frostfang";
    if (haystack.includes("moonshadow")) return "moonshadow";
    return null;
}

function easeInOut(value: number): number {
    return 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, value))) / 2;
}

function renderMix(): void {
    if (!decks) return;
    decks[0].volume = Math.min(1, BASE_VOLUME * mix[0] * duckMultiplier);
    decks[1].volume = Math.min(1, BASE_VOLUME * mix[1] * duckMultiplier);
}

function cancelMixFrame(): void {
    if (mixFrame === null || typeof window === "undefined") return;
    window.cancelAnimationFrame(mixFrame);
    mixFrame = null;
}

function cancelDuckFrame(): void {
    if (duckFrame === null || typeof window === "undefined") return;
    window.cancelAnimationFrame(duckFrame);
    duckFrame = null;
}

function installListeners(): void {
    if (listenersInstalled || typeof document === "undefined") return;
    listenersInstalled = true;
    subscribeAudioMute(() => {
        if (!decks) return;
        if (isAudioMuted()) {
            decks.forEach((deck) => deck.pause());
            return;
        }
        const deck = decks[activeDeck];
        if (currentKey && !document.hidden) void deck.play().catch(() => {});
    });
    document.addEventListener("visibilitychange", () => {
        if (!decks) return;
        if (document.hidden || isAudioMuted()) {
            decks.forEach((deck) => deck.pause());
        } else if (currentKey) {
            void decks[activeDeck].play().catch(() => {});
        }
    });
}

function ensureDecks(): [HTMLAudioElement, HTMLAudioElement] | null {
    if (typeof window === "undefined") return null;
    if (!decks) {
        decks = [new Audio(), new Audio()];
        for (const deck of decks) {
            deck.loop = true;
            deck.preload = "auto";
            deck.volume = 0;
        }
        installListeners();
    }
    return decks;
}

function animateMix(
    target: [number, number],
    durationMs: number,
    onComplete?: () => void,
): void {
    if (typeof window === "undefined") return;
    cancelMixFrame();
    const from: [number, number] = [...mix];
    const startedAt = performance.now();
    const frame = (now: number) => {
        const progress = durationMs <= 0 ? 1 : Math.min(1, (now - startedAt) / durationMs);
        const eased = easeInOut(progress);
        mix = [
            from[0] + (target[0] - from[0]) * eased,
            from[1] + (target[1] - from[1]) * eased,
        ];
        renderMix();
        if (progress < 1) {
            mixFrame = window.requestAnimationFrame(frame);
            return;
        }
        mixFrame = null;
        onComplete?.();
    };
    mixFrame = window.requestAnimationFrame(frame);
}

/** Start the chapter score, preserving playback when the route has not changed. */
export function startVnScore(key: VnScoreKey | null): void {
    try {
        if (!key || isAudioMuted()) {
            stopVnScore(key ? 250 : 650);
            return;
        }
        const audioDecks = ensureDecks();
        if (!audioDecks) return;
        if (currentKey === key) {
            if (!document.hidden) void audioDecks[activeDeck].play().catch(() => {});
            return;
        }

        const incomingIndex = currentKey === null ? activeDeck : 1 - activeDeck;
        const outgoingIndex = 1 - incomingIndex;
        const incoming = audioDecks[incomingIndex];
        const outgoing = audioDecks[outgoingIndex];
        incoming.pause();
        incoming.src = VN_SCORE_TRACKS[key];
        incoming.currentTime = 0;
        incoming.playbackRate = 1;
        currentKey = key;
        activeDeck = incomingIndex;
        void incoming.play().catch(() => {
            // Autoplay policy: advance(), unmute, or another stage gesture retries.
        });

        const target: [number, number] = incomingIndex === 0 ? [1, 0] : [0, 1];
        animateMix(target, CROSSFADE_MS, () => {
            outgoing.pause();
            outgoing.currentTime = 0;
        });
    } catch {
        // Music is optional. It must never interrupt the story.
    }
}

/** Fade and pause both decks without discarding their preloaded sources. */
export function stopVnScore(fadeMs = 900): void {
    try {
        currentKey = null;
        cancelDuckFrame();
        duckMultiplier = 1;
        if (!decks) return;
        animateMix([0, 0], fadeMs, () => {
            decks?.forEach((deck) => {
                deck.pause();
                deck.currentTime = 0;
            });
        });
    } catch {
        // Optional audio.
    }
}

const DUCKING: Readonly<Partial<Record<VnSoundCue, { floor: number; holdMs: number }>>> = {
    title: { floor: 0.72, holdMs: 850 },
    reveal: { floor: 0.56, holdMs: 1_150 },
    omen: { floor: 0.58, holdMs: 1_050 },
    decision: { floor: 0.78, holdMs: 300 },
    battle: { floor: 0.48, holdMs: 800 },
};

/** Make a sparse authored cue readable without making either bus loud. */
export function duckVnScore(cue: VnSoundCue): void {
    const duck = DUCKING[cue];
    if (!duck || !decks || typeof window === "undefined") return;
    cancelDuckFrame();
    const startedAt = performance.now();
    const attackMs = 65;
    const releaseMs = 520;
    const finishAt = attackMs + duck.holdMs + releaseMs;
    const frame = (now: number) => {
        const elapsed = now - startedAt;
        if (elapsed < attackMs) {
            duckMultiplier = 1 - (1 - duck.floor) * easeInOut(elapsed / attackMs);
        } else if (elapsed < attackMs + duck.holdMs) {
            duckMultiplier = duck.floor;
        } else {
            const release = (elapsed - attackMs - duck.holdMs) / releaseMs;
            duckMultiplier = duck.floor + (1 - duck.floor) * easeInOut(release);
        }
        renderMix();
        if (elapsed < finishAt) {
            duckFrame = window.requestAnimationFrame(frame);
            return;
        }
        duckMultiplier = 1;
        duckFrame = null;
        renderMix();
    };
    duckFrame = window.requestAnimationFrame(frame);
}
