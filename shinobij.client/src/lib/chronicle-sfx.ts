import {
  playGameSfx,
  primeGameAudio,
  type GameSfxCue,
} from "./game-audio";

export type ChronicleSfx =
  | "draw"
  | "summon"
  | "set"
  | "activate"
  | "attack"
  | "destroy"
  | "victory"
  | "defeat"
  | "pack-tear"
  | "pack-pop"
  | "card-flip"
  | "reveal-rare"
  | "reveal-epic"
  | "reveal-legendary"
  | "reveal-mythic";

const MUTE_KEY = "chronicleSfx.v1";
let muted: boolean | null = null;

const CHRONICLE_CUES: Record<
  ChronicleSfx,
  { cue: GameSfxCue; gain?: number; playbackRate?: number }
> = {
  draw: { cue: "paper", gain: 0.65, playbackRate: 1.03 },
  summon: { cue: "reveal", gain: 0.82, playbackRate: 0.96 },
  set: { cue: "card-place" },
  activate: { cue: "reveal", gain: 0.62, playbackRate: 1.04 },
  attack: { cue: "impact-light", gain: 0.88 },
  destroy: { cue: "impact-heavy", gain: 0.94 },
  victory: { cue: "victory-seal" },
  defeat: { cue: "omen", gain: 0.68, playbackRate: 0.92 },
  "pack-tear": { cue: "foil-tear" },
  "pack-pop": { cue: "pack-pop" },
  "card-flip": { cue: "card-place", gain: 0.72, playbackRate: 1.06 },
  "reveal-rare": { cue: "reveal", gain: 0.58, playbackRate: 1.04 },
  "reveal-epic": { cue: "reveal", gain: 0.72 },
  "reveal-legendary": { cue: "reveal", gain: 0.92, playbackRate: 0.97 },
  "reveal-mythic": { cue: "mythic", gain: 0.88 },
};

function readMuted(): boolean {
  if (muted !== null) return muted;
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "off";
  } catch {
    muted = false;
  }
  return muted;
}

export function chronicleSfxMuted(): boolean {
  return readMuted();
}

export function setChronicleSfxMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "off" : "on");
  } catch {
    // Session-only preference when storage is unavailable.
  }
}

export function primeChronicleSfx(): void {
  if (readMuted()) return;
  primeGameAudio([
    "paper",
    "card-place",
    "foil-tear",
    "pack-pop",
    "reveal",
    "mythic",
    "impact-light",
    "impact-heavy",
    "victory-seal",
    "omen",
  ]);
}

export function playChronicleSfx(kind: ChronicleSfx): void {
  if (readMuted()) return;
  const mapped = CHRONICLE_CUES[kind];
  playGameSfx(mapped.cue, {
    gain: mapped.gain,
    playbackRate: mapped.playbackRate,
  });
}

/** Map a battle-log line to a cue. Order matters: a destruction line often
 * also names the attack that caused it. Bookkeeping lines remain silent. */
export function classifyChronicleLogLine(line: string): ChronicleSfx | null {
  if (/destroy/i.test(line)) return "destroy";
  if (/damage step|attacks directly/i.test(line)) return "attack";
  if (/summons|sets a monster/i.test(line)) return "summon";
  if (/sets a snare/i.test(line)) return "set";
  if (/activates|may respond/i.test(line)) return "activate";
  if (/draws? /i.test(line)) return "draw";
  return null;
}
