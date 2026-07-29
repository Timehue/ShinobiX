import { playGameSfx, primeGameAudio } from "./game-audio";

const VILLAGE_RATE: Record<string, number> = {
  "Stormveil Village": 0.98,
  "Ashen Leaf Village": 0.94,
  "Frostfang Village": 1.04,
  "Moonshadow Village": 1,
};

export function primeStorySfx(): void {
  primeGameAudio(["chapter-seal", "battle-transition", "victory-seal"]);
}

/** A shared ceremonial identity keeps chapter openings in the same world.
 * Tiny rate shifts preserve village color without turning them into jingles. */
export function playStoryChapterSting(village: string | undefined): void {
  playGameSfx("chapter-seal", {
    playbackRate: village ? VILLAGE_RATE[village] : 1,
  });
}

export function playStoryFinalPhaseSting(): void {
  playGameSfx("battle-transition", { gain: 0.78, playbackRate: 0.95 });
}

export function playStoryVictorySting(): void {
  playGameSfx("victory-seal", { gain: 0.92 });
}
