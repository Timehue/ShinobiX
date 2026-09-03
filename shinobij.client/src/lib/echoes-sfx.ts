// Echoes of War audio cues — a thin mapping over the shared game-audio layer
// (no new synthesis or assets). Honors the SAME mute toggle as the Chronicle
// board (chronicleSfx.v1), because to the player this is all one card game.
import { playGameSfx, startGameAmbience, stopGameAmbience } from "./game-audio";
import { chronicleSfxMuted } from "./chronicle-sfx";

export type EchoesSfx =
    /** Stepping into a preserved memory (scene start / battle transition). */
    | "enter-memory"
    /** Chronicle Points credited on a repeat win. */
    | "reward"
    /** A first clear: the record closes and the next floor opens. */
    | "record-sealed"
    /** The chapter boss falls. */
    | "chapter-complete"
    /** A loss or draw: the memory holds. */
    | "memory-holds";

const CUES: Record<EchoesSfx, Parameters<typeof playGameSfx>> = {
    "enter-memory": ["battle-transition", { gain: 0.5, playbackRate: 0.9 }],
    reward: ["chakra-positive", { gain: 0.7 }],
    "record-sealed": ["victory-seal", { gain: 0.85 }],
    "chapter-complete": ["chapter-seal", { gain: 0.9, playbackRate: 0.95 }],
    "memory-holds": ["omen", { gain: 0.55, playbackRate: 0.9 }],
};

export function playEchoesSfx(cue: EchoesSfx): void {
    if (chronicleSfxMuted()) return;
    try {
        playGameSfx(...CUES[cue]);
    } catch {
        // Audio is flavor; never let it interrupt the campaign.
    }
}

/** Subdued tower ambience while the memory ladder is on screen. */
export function startEchoesAmbience(): void {
    if (chronicleSfxMuted()) return;
    try {
        startGameAmbience("ambience-interior", { gain: 0.03, fadeMs: 1200 });
    } catch {
        // Ambience is flavor; never let it interrupt the campaign.
    }
}

export function stopEchoesAmbience(): void {
    try {
        stopGameAmbience(600);
    } catch {
        // Ambience is flavor; never let it interrupt the campaign.
    }
}
