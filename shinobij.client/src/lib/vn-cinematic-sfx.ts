import {
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
