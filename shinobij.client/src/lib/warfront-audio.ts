import {
  playGameSfx,
  primeGameAudio,
  startGameAmbience,
  stopGameAmbience,
  type GameSfxCue,
} from "./game-audio";
import { isPetSfxMuted } from "./pet-sfx";
import {
  duckBattleMusic,
  setBattleMusicIntensity,
  startBattleMusic,
  stopBattleMusic,
  type BattleMusicIntensity,
} from "./pet-music";
import type { WfEvent } from "./pet-warfront-sim";

export type WarfrontAudioBeat = {
  cue: GameSfxCue;
  gain?: number;
  playbackRate?: number;
};

const audioBeat = (cue: GameSfxCue, gain: number, playbackRate?: number): WarfrontAudioBeat => ({ cue, gain, playbackRate });

function sampled(t: number, key: string, every: number): boolean {
  return (t + key.length + key.charCodeAt(0) + key.charCodeAt(key.length - 1)) % every === 0;
}

const WARFRONT_PRIME_CUES: GameSfxCue[] = [
  "impact-light",
  "impact-heavy",
  "guard",
  "evade",
  "chakra-positive",
  "chakra-negative",
  "knockout",
  "victory-seal",
  "command",
  "crowd",
  "reveal",
  "mythic",
  "chapter-seal",
  "omen",
  "decision",
  "battle-transition",
  "warfront-sigil-awakening",
  "warfront-warden-awakening",
  "warfront-objective-steal",
];

let warfrontBedActive = false;

export function warfrontMusicBeat(event: WfEvent): {
  intensity?: BattleMusicIntensity;
  duck?: { level: number; holdMs: number };
} {
  if (event.type === "phase") {
    if (event.name === "SUDDEN DEATH") return { intensity: "climax", duck: { level: 0.34, holdMs: 1_200 } };
    if (event.name === "WAR") return { intensity: "pressure", duck: { level: 0.3, holdMs: 4_200 } };
    return { intensity: "pressure", duck: { level: 0.48, holdMs: 850 } };
  }
  if (event.type === "sigilawake") return { duck: { level: 0.38, holdMs: 3_200 } };
  if (event.type === "ascendance" || (event.type === "wardenphase" && event.phase === 3)) {
    return { intensity: "climax", duck: { level: 0.34, holdMs: 1_100 } };
  }
  if (event.type === "coredown" || event.type === "verdict") return { duck: { level: 0.24, holdMs: 1_800 } };
  if (event.type === "minikill" && event.awakened && event.stolen) return { duck: { level: 0.3, holdMs: 2_500 } };
  if (event.type === "wardenkill" || event.type === "siegebreak" || (event.type === "minikill" && event.awakened)) {
    return { duck: { level: 0.34, holdMs: 1_250 } };
  }
  if (event.type === "counterstrikeclaim") return { duck: { level: 0.3, holdMs: 1_250 } };
  if (event.type === "techniqueused" || event.type === "counterstrike") return { duck: { level: 0.42, holdMs: 900 } };
  if (event.type === "statuedown" || event.type === "guardiandown" || event.type === "opening") {
    return { duck: { level: 0.48, holdMs: 800 } };
  }
  return {};
}

/**
 * Sparse broadcast mix. Routine attacks are deliberately sampled so four lanes
 * never become an undifferentiated wall of impacts; decisive state changes own
 * the loudest and longest cues.
 */
export function warfrontAudioBeats(event: WfEvent): WarfrontAudioBeat[] {
  switch (event.type) {
    case "hit":
      if (event.crit) return [audioBeat("impact-heavy", 0.82)];
      return event.t % 9 === 0 ? [audioBeat("impact-light", 0.5)] : [];
    case "heal":
      return [audioBeat("chakra-positive", 0.52, 1.04)];
    case "kill":
      return [audioBeat("knockout", 0.88)];
    case "shutdown":
      return [
        audioBeat("battle-transition", 0.72, 0.96),
        audioBeat("crowd", 0.45),
      ];
    case "gank":
      return [audioBeat("command", 0.52, 1.08)];
    case "ability":
      if (!sampled(event.t, `${event.petId}:${event.kind}`, 2)) return [];
      if (event.kind === "shield") return [audioBeat("guard", 0.62)];
      if (event.kind === "dash") return [audioBeat("evade", 0.42)];
      return [audioBeat("chakra-negative", 0.44)];
    case "bosssig":
      return [audioBeat(
        event.kind === "shell" ? "guard" : event.kind === "blink" ? "evade"
          : event.kind === "flame" ? "chakra-negative" : event.kind === "roar" ? "omen" : "impact-heavy",
        0.72,
        0.9,
      )];
    case "elemsig": {
      if (!sampled(event.t, `${event.petId}:${event.el}`, 2)) return [];
      const cue: GameSfxCue = event.el === "Water" ? "chakra-positive"
        : event.el === "Earth" ? "guard"
          : event.el === "Wind" ? "evade"
            : "chakra-negative";
      return [audioBeat(cue, 0.62, event.el === "Earth" ? 0.9 : 1.06)];
    }
    case "structhit":
      return event.t % 15 === 0 ? [audioBeat("impact-heavy", 0.42, 0.92)] : [];
    case "statuedown":
    case "guardiandown":
    case "siegebreak":
      return [
        audioBeat("impact-heavy", 0.9, 0.9),
        audioBeat("battle-transition", 0.48),
      ];
    case "coreexposed":
      return [audioBeat("omen", 0.82, 1.04)];
    case "coredown":
      return [
        audioBeat("victory-seal", 1),
        audioBeat("crowd", 0.62),
      ];
    case "verdict":
      return event.winner === "draw"
        ? [audioBeat("chapter-seal", 0.9, 0.92)]
        : [
            audioBeat("victory-seal", 0.92),
            audioBeat("crowd", 0.52),
          ];
    case "sigilsoon":
      return [audioBeat("command", 0.78, 1.04)];
    case "sigilawake":
      return [audioBeat("warfront-sigil-awakening", 1)];
    case "minikill":
      return event.awakened
        ? event.stolen
          ? [
              audioBeat("warfront-objective-steal", 1),
            ]
          : [audioBeat("chapter-seal", 0.9)]
        : [audioBeat("knockout", 0.48, 1.08)];
    case "minimarch":
    case "guardianrally":
      return [audioBeat("command", 0.76, 0.94)];
    case "siegeescort":
      return event.escorted ? [audioBeat("chakra-positive", 0.42)] : [];
    case "opening":
      return [audioBeat(event.winner ? "reveal" : "decision", 0.7)];
    case "readreserve":
      return [audioBeat("chakra-positive", 0.62, 0.94)];
    case "sigilpip":
      return [audioBeat("chapter-seal", 0.8, 1.04)];
    case "ascendance":
      return [
        audioBeat("mythic", 0.92),
        audioBeat("crowd", 0.5),
      ];
    case "wardensoon":
      return [audioBeat("omen", 0.94, 0.9)];
    case "wardenwindup":
      return [audioBeat("omen", 0.52, 1.1)];
    case "wardenslam":
    case "wardenshock":
      return [audioBeat("impact-heavy", 0.94, 0.86)];
    case "wardenphase":
      return [audioBeat("battle-transition", 0.76, 0.9)];
    case "wardenkill":
      return event.stolen
        ? [
            audioBeat("chakra-negative", 1, 0.88),
            audioBeat("mythic", 0.82, 1.08),
          ]
        : [audioBeat("mythic", 0.92)];
    case "mercy":
      return [audioBeat("omen", 0.84, 0.86)];
    case "stance":
    case "buy":
      return [audioBeat("decision", 0.56)];
    case "deployment":
    case "coachorder":
      return [audioBeat("command", 0.5, 1.04)];
    case "buildpackage":
    case "objectivetechnique":
      return [audioBeat("decision", 0.54)];
    case "packageproc":
      return [audioBeat(event.choice === "hold-line" ? "guard" : event.choice === "blood-hunt" ? "chakra-negative" : "chakra-positive", 0.46)];
    case "techniqueused":
      return [audioBeat(event.choice === "secure" ? "impact-heavy" : event.choice === "hijack" ? "warfront-objective-steal" : "guard", 0.88)];
    case "counterstrike":
      return [audioBeat(event.choice === "fortify" ? "guard" : event.choice === "cross-map" ? "command" : "omen", 0.82)];
    case "counterstrikeclaim":
      return [audioBeat("knockout", 0.9), audioBeat("crowd", 0.46)];
    case "ultimate":
      return [audioBeat("battle-transition", 0.56, 1.08)];
    case "phase":
      return event.name === "WAR"
        ? [audioBeat("warfront-warden-awakening", 1)]
        : [audioBeat("battle-transition", 0.5, 0.96)];
    default:
      return [];
  }
}

export const createWarfrontAudioMixState = () => ({ t: -1, g: {} as Record<string, [number, number]>, b: new Map<string, number>() });

export function isCriticalWarfrontAudioEvent(event: WfEvent): boolean {
  return event.type === "coredown"
    || event.type === "verdict"
    || event.type === "sigilawake"
    || event.type === "ascendance"
    || event.type === "wardenkill"
    || event.type === "phase"
    || event.type === "counterstrikeclaim"
    || (event.type === "minikill" && event.stolen)
    || event.type === "wardenphase";
}

export function scheduledWarfrontAudioBeats(event: WfEvent, state: ReturnType<typeof createWarfrontAudioMixState>): WarfrontAudioBeat[] {
  if (event.t < state.t) {
    state.g = {};
    state.b.clear();
  }
  state.t = event.t;
  for (const [petId, expires] of state.b) if (expires < event.t) state.b.delete(petId);
  if (event.type === "buy") state.b.set(event.petId, event.t + 2_700);

  const payoff = (event.type === "kill" || event.type === "shutdown") && state.b.has(event.actorId);
  const beats = warfrontAudioBeats(event);
  if (payoff) beats.push(audioBeat("reveal", 0.52, 1.06));
  if (beats.length === 0) return beats;

  const type = ` ${event.type} `;
  const critical = isCriticalWarfrontAudioEvent(event);
  const salience = " shutdown coredown verdict sigilawake ascendance wardenkill phase counterstrikeclaim ".includes(type)
    || (event.type === "minikill" && event.stolen) || (event.type === "wardenphase" && event.phase === 3) ? 3
    : payoff || " kill statuedown guardiandown siegebreak coreexposed minikill opening sigilpip wardensoon wardenslam wardenshock wardenphase mercy ultimate techniqueused counterstrike ".includes(type) ? 2 : 1;
  const routine = " hit heal ability structhit ".includes(type);
  const family = event.type === "packageproc" ? `p:${event.team}:${event.choice}` : routine ? "c" : "b";
  const cooldown = event.type === "packageproc" ? 360 : routine ? 8 : " kill shutdown ".includes(type) ? 18 : 45;
  const gate = state.g[family];
  // A real payoff consumes its Council purchase even when a stronger cue owns
  // the mix at that instant; otherwise a later unrelated kill gets false credit.
  if (payoff) state.b.delete(event.actorId);
  // Broadcast-critical cues always replace the current family gate. This is
  // intentionally stronger than equal-salience cooldown suppression: a Sigil,
  // Warden phase, WAR transition, steal, or verdict must never disappear just
  // because another payoff landed a few simulation ticks earlier.
  if (!critical && gate && event.t < gate[0] && salience <= gate[1]) return [];
  state.g[family] = [event.t + cooldown, salience];
  return beats;
}

export function scheduledWarfrontAudioPlan(event: WfEvent, state: ReturnType<typeof createWarfrontAudioMixState>) {
  return {
    music: warfrontMusicBeat(event),
    beats: scheduledWarfrontAudioBeats(event, state),
  };
}

let warfrontMix = createWarfrontAudioMixState();

/** Rebuild the silent broadcast mix at an arbitrary replay frontier. This keeps
 * phase music, Council investments, and already-consumed payoff motifs faithful
 * when a turning-point clip begins after the events that established them. */
export function seekWarfrontAudio(events: readonly WfEvent[], tick: number) {
  warfrontMix = createWarfrontAudioMixState();
  let intensity: BattleMusicIntensity = "calm";
  for (const event of events) {
    if (event.t > tick) break;
    scheduledWarfrontAudioBeats(event, warfrontMix);
    const next = warfrontMusicBeat(event).intensity;
    if (next) intensity = next;
  }
  if (!isPetSfxMuted()) setBattleMusicIntensity(intensity);
  return [intensity, warfrontMix] as const;
}

export function primeWarfrontAudio(): void {
  if (isPetSfxMuted()) return;
  primeGameAudio([...WARFRONT_PRIME_CUES, "ambience-hollow"]);
}

export function startWarfrontAudioBed(): void {
  if (isPetSfxMuted()) return;
  setBattleMusicIntensity("calm");
  if (!warfrontBedActive) {
    warfrontBedActive = true;
    warfrontMix = createWarfrontAudioMixState();
    startBattleMusic("hollow-gate");
  }
  startGameAmbience("ambience-hollow", { gain: 0.024, fadeMs: 1_400 });
}

export function stopWarfrontAudioBed(): void {
  warfrontBedActive = false;
  warfrontMix = createWarfrontAudioMixState();
  stopGameAmbience(900);
  stopBattleMusic();
}

export function playWarfrontEventAudio(event: WfEvent): void {
  if (isPetSfxMuted()) return;
  const critical = isCriticalWarfrontAudioEvent(event);
  // Score state and ducking are a separate bus from the sparse SFX scheduler.
  // Apply them even when a family cooldown correctly suppresses the event cue.
  const { music, beats } = scheduledWarfrontAudioPlan(event, warfrontMix);
  if (music.intensity) setBattleMusicIntensity(music.intensity);
  if (music.duck) duckBattleMusic(music.duck.level, music.duck.holdMs);
  for (const beat of beats) {
    playGameSfx(beat.cue, {
      gain: beat.gain,
      playbackRate: beat.playbackRate,
      priority: critical ? "critical" : undefined,
    });
  }
}
