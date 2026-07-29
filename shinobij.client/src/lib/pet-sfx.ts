import {
  playGameSfx,
  primeGameAudio,
  type GameSfxCue,
} from "./game-audio";
import { isAudioMuted } from "./pet-music";

export type PetSfxKind =
  | "hit"
  | "crit"
  | "ko"
  | "heal"
  | "buff"
  | "dot"
  | "debuff"
  | "movelock"
  | "dodge"
  | "shield"
  | "move"
  | "victory"
  | "superEffective"
  | "command"
  | "finisher"
  | "crowd";

const MUTE_KEY = "petSfxMuted";

const PET_CUES: Record<
  PetSfxKind,
  { cue: GameSfxCue; gain?: number; playbackRate?: number }
> = {
  hit: { cue: "impact-light" },
  crit: { cue: "impact-heavy" },
  ko: { cue: "knockout" },
  heal: { cue: "chakra-positive" },
  buff: { cue: "chakra-positive", gain: 0.85, playbackRate: 1.04 },
  dot: { cue: "chakra-negative", gain: 0.72, playbackRate: 1.06 },
  debuff: { cue: "chakra-negative" },
  movelock: { cue: "chakra-negative", gain: 0.82, playbackRate: 0.94 },
  dodge: { cue: "evade" },
  shield: { cue: "guard" },
  move: { cue: "evade", gain: 0.62, playbackRate: 0.96 },
  victory: { cue: "victory-seal" },
  superEffective: { cue: "reveal", gain: 0.52, playbackRate: 1.04 },
  command: { cue: "command" },
  finisher: { cue: "battle-transition", gain: 0.7 },
  crowd: { cue: "crowd" },
};

export function isPetSfxMuted(): boolean {
  if (isAudioMuted()) return true;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPetSfxMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Session-only preference when storage is unavailable.
  }
}

export function primePetSfx(): void {
  if (isPetSfxMuted()) return;
  primeGameAudio([
    "impact-light",
    "impact-heavy",
    "guard",
    "evade",
    "chakra-positive",
    "chakra-negative",
    "knockout",
    "victory-seal",
    "command",
    "battle-transition",
  ]);
}

export function playPetSfx(kind: PetSfxKind): void {
  if (isPetSfxMuted()) return;
  const mapped = PET_CUES[kind];
  playGameSfx(mapped.cue, {
    gain: mapped.gain,
    playbackRate: mapped.playbackRate,
  });
}
