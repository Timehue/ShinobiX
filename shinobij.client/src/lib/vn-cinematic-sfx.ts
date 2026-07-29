import type { VnSoundCue } from "../types/vn";
import {
  playGameSfx,
  primeGameAudio,
  startGameAmbience,
  stopGameAmbience,
  type GameAmbienceCue,
} from "./game-audio";

export type VnAmbience = "none" | "village" | "road" | "interior" | "hollow";

const AMBIENCE_CUES: Record<
  Exclude<VnAmbience, "none">,
  { cue: GameAmbienceCue; gain: number }
> = {
  village: { cue: "ambience-village", gain: 0.034 },
  road: { cue: "ambience-road", gain: 0.04 },
  interior: { cue: "ambience-interior", gain: 0.03 },
  hollow: { cue: "ambience-hollow", gain: 0.036 },
};

let lastCue: VnSoundCue = "none";
let lastCueAt = 0;

export function playVnCue(cue: VnSoundCue): void {
  if (cue === "none") return;
  const now = performance.now();
  if (lastCue === cue && now - lastCueAt < 180) return;
  lastCue = cue;
  lastCueAt = now;

  switch (cue) {
    case "title":
      playGameSfx("chapter-seal", { gain: 0.86 });
      break;
    case "paper":
      playGameSfx("paper", { gain: 0.82 });
      break;
    case "reveal":
      playGameSfx("reveal", { gain: 0.8 });
      break;
    case "omen":
      playGameSfx("omen", { gain: 0.82 });
      break;
    case "decision":
      playGameSfx("decision", { gain: 0.86 });
      break;
    case "battle":
      playGameSfx("battle-transition", { gain: 0.86 });
      break;
  }
}

export function startVnAmbience(kind: VnAmbience): void {
  if (kind === "none") {
    stopGameAmbience(420);
    return;
  }
  const mapped = AMBIENCE_CUES[kind];
  primeGameAudio([
    mapped.cue,
    "chapter-seal",
    "paper",
    "reveal",
    "omen",
    "decision",
    "battle-transition",
  ]);
  startGameAmbience(mapped.cue, { gain: mapped.gain, fadeMs: 1_100 });
}

export function stopVnAmbience(fadeMs = 700): void {
  stopGameAmbience(fadeMs);
}
