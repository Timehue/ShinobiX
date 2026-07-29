import {
  playGameSfx,
  primeGameAudio,
  startGameAmbience,
  stopGameAmbience,
} from "../../lib/game-audio";

export type IntroCue =
  | "advance"
  | "title"
  | "reveal"
  | "omen"
  | "confirm"
  | "whiteout";

export function startIntroAmbience(): void {
  primeGameAudio([
    "ambience-shrine",
    "chapter-seal",
    "reveal",
    "omen",
    "decision",
    "battle-transition",
  ]);
  startGameAmbience("ambience-shrine", { gain: 0.042, fadeMs: 1_800 });
}

export function stopIntroAmbience(fadeMs = 1_000): void {
  stopGameAmbience(fadeMs);
}

export function introCue(kind: IntroCue): void {
  switch (kind) {
    case "advance":
      // Dialogue progression is intentionally silent.
      break;
    case "title":
      playGameSfx("chapter-seal", { gain: 0.92 });
      break;
    case "reveal":
      playGameSfx("reveal", { gain: 0.84 });
      break;
    case "omen":
      playGameSfx("omen", { gain: 0.86 });
      break;
    case "confirm":
      playGameSfx("decision", { gain: 0.88 });
      break;
    case "whiteout":
      playGameSfx("battle-transition", { gain: 0.66, playbackRate: 1.04 });
      break;
  }
}
