import {
  isAudioMuted,
  subscribeAudioMute,
} from "./pet-music";
import { sfxDeliveryPath } from "./audio-delivery";

export type GameSfxCue =
  | "impact-light"
  | "impact-heavy"
  | "guard"
  | "evade"
  | "chakra-positive"
  | "chakra-negative"
  | "knockout"
  | "victory-seal"
  | "command"
  | "crowd"
  | "paper"
  | "foil-tear"
  | "card-place"
  | "pack-pop"
  | "reveal"
  | "mythic"
  | "chapter-seal"
  | "omen"
  | "decision"
  | "battle-transition";

export type GameAmbienceCue =
  | "ambience-shrine"
  | "ambience-village"
  | "ambience-road"
  | "ambience-interior"
  | "ambience-hollow";

type AudioCueDefinition = {
  path: string;
  gain: number;
  group: "impact" | "movement" | "status" | "terminal" | "ritual" | "story";
  cooldownMs: number;
  voiceLimit: number;
  rateJitter?: number;
};

const SFX_DEFINITIONS: Record<GameSfxCue, AudioCueDefinition> = {
  "impact-light": {
    path: "/sfx/production/impact-light.wav",
    gain: 0.34,
    group: "impact",
    cooldownMs: 72,
    voiceLimit: 2,
    rateJitter: 0.028,
  },
  "impact-heavy": {
    path: "/sfx/production/impact-heavy.wav",
    gain: 0.42,
    group: "impact",
    cooldownMs: 100,
    voiceLimit: 2,
    rateJitter: 0.018,
  },
  guard: {
    path: "/sfx/production/guard.wav",
    gain: 0.3,
    group: "impact",
    cooldownMs: 120,
    voiceLimit: 2,
    rateJitter: 0.012,
  },
  evade: {
    path: "/sfx/production/evade.wav",
    gain: 0.18,
    group: "movement",
    cooldownMs: 150,
    voiceLimit: 1,
    rateJitter: 0.025,
  },
  "chakra-positive": {
    path: "/sfx/production/chakra-positive.wav",
    gain: 0.15,
    group: "status",
    cooldownMs: 280,
    voiceLimit: 1,
  },
  "chakra-negative": {
    path: "/sfx/production/chakra-negative.wav",
    gain: 0.14,
    group: "status",
    cooldownMs: 280,
    voiceLimit: 1,
  },
  knockout: {
    path: "/sfx/production/knockout.wav",
    gain: 0.38,
    group: "terminal",
    cooldownMs: 900,
    voiceLimit: 1,
  },
  "victory-seal": {
    path: "/sfx/production/victory-seal.wav",
    gain: 0.2,
    group: "terminal",
    cooldownMs: 1_500,
    voiceLimit: 1,
  },
  command: {
    path: "/sfx/production/command.wav",
    gain: 0.12,
    group: "ritual",
    cooldownMs: 180,
    voiceLimit: 1,
    rateJitter: 0.012,
  },
  crowd: {
    path: "/sfx/production/crowd.wav",
    gain: 0.1,
    group: "terminal",
    cooldownMs: 5_000,
    voiceLimit: 1,
  },
  paper: {
    path: "/sfx/production/paper.wav",
    gain: 0.11,
    group: "ritual",
    cooldownMs: 220,
    voiceLimit: 1,
    rateJitter: 0.018,
  },
  "foil-tear": {
    path: "/sfx/production/foil-tear.wav",
    gain: 0.17,
    group: "ritual",
    cooldownMs: 500,
    voiceLimit: 1,
  },
  "card-place": {
    path: "/sfx/production/card-place.wav",
    gain: 0.12,
    group: "ritual",
    cooldownMs: 140,
    voiceLimit: 2,
    rateJitter: 0.02,
  },
  "pack-pop": {
    path: "/sfx/production/pack-pop.wav",
    gain: 0.14,
    group: "ritual",
    cooldownMs: 500,
    voiceLimit: 1,
  },
  reveal: {
    path: "/sfx/production/reveal.wav",
    gain: 0.15,
    group: "ritual",
    cooldownMs: 360,
    voiceLimit: 1,
  },
  mythic: {
    path: "/sfx/production/mythic.wav",
    gain: 0.13,
    group: "ritual",
    cooldownMs: 1_000,
    voiceLimit: 1,
  },
  "chapter-seal": {
    path: "/sfx/production/chapter-seal.wav",
    gain: 0.17,
    group: "story",
    cooldownMs: 700,
    voiceLimit: 1,
  },
  omen: {
    path: "/sfx/production/omen.wav",
    gain: 0.15,
    group: "story",
    cooldownMs: 650,
    voiceLimit: 1,
  },
  decision: {
    path: "/sfx/production/decision.wav",
    gain: 0.13,
    group: "story",
    cooldownMs: 300,
    voiceLimit: 1,
  },
  "battle-transition": {
    path: "/sfx/production/battle-transition.wav",
    gain: 0.24,
    group: "story",
    cooldownMs: 800,
    voiceLimit: 1,
  },
};

const AMBIENCE_PATHS: Record<GameAmbienceCue, string> = {
  "ambience-shrine": "/sfx/production/ambience-shrine.wav",
  "ambience-village": "/sfx/production/ambience-village.wav",
  "ambience-road": "/sfx/production/ambience-road.wav",
  "ambience-interior": "/sfx/production/ambience-interior.wav",
  "ambience-hollow": "/sfx/production/ambience-hollow.wav",
};

type Voice = {
  source: AudioBufferSourceNode;
  startedAt: number;
};

type AmbienceVoice = {
  cue: GameAmbienceCue;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
let unsubscribeMute: (() => void) | null = null;
let ambienceRequest: GameAmbienceCue | null = null;
let ambienceOptions: { gain?: number; fadeMs?: number } = {};
let ambienceVoice: AmbienceVoice | null = null;

const MASTER_GAIN = 0.92;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const lastPlayedAt = new Map<GameSfxCue, number>();
const voicesByGroup = new Map<AudioCueDefinition["group"], Voice[]>();

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!context) {
      const Context = window.AudioContext
        ?? (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
      if (!Context) return null;
      context = new Context();

      master = context.createGain();
      master.gain.value = isAudioMuted() ? 0 : MASTER_GAIN;

      limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -5;
      limiter.knee.value = 8;
      limiter.ratio.value = 3;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.14;

      master.connect(limiter);
      limiter.connect(context.destination);

      unsubscribeMute = subscribeAudioMute(() => {
        if (isAudioMuted()) {
          // Zero the bus before stopping sources. This makes the master switch
          // instantaneous even when an ambience loop was mid-crossfade.
          if (master && context) {
            master.gain.cancelScheduledValues(context.currentTime);
            master.gain.setValueAtTime(0, context.currentTime);
          }
          const active = ambienceVoice;
          ambienceVoice = null;
          if (active) stopAmbienceImmediately(active);
          stopAllVoices();
        } else {
          if (master && context) {
            master.gain.cancelScheduledValues(context.currentTime);
            master.gain.setValueAtTime(MASTER_GAIN, context.currentTime);
          }
          if (context?.state === "suspended") {
            void context.resume().catch(() => {});
          }
          if (ambienceRequest && !ambienceVoice) {
            startGameAmbience(ambienceRequest, ambienceOptions);
          }
        }
      });
    }
    if (context.state === "suspended" && !isAudioMuted()) {
      void context.resume().catch(() => {});
    }
    return context;
  } catch {
    return null;
  }
}

/*
 * Delivery format. The authored masters under public/sfx/production are 48 kHz
 * stereo 16-bit WAV — ~13.6 MB across 25 cues, and the five ambience beds alone
 * are ~10.2 MB. scripts/encode-audio.mjs writes a .ogg (Vorbis) and .m4a (AAC)
 * sibling for every master; sfxDeliveryPath picks whichever this browser can
 * decode, which takes the same 25 cues to ~1.1 MB. See lib/audio-delivery.ts for
 * why Vorbis wins where it is available (it is gapless, which the looping
 * ambience beds depend on) and why WebKit gets AAC.
 *
 * The .wav masters stay shipped and stay last in the chain, so a browser that
 * decodes neither codec — or a deploy where the siblings went missing — still
 * gets sound rather than silence.
 */
async function decodeFrom(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return await ctx.decodeAudioData(await response.arrayBuffer());
}

async function loadBuffer(path: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(path);
  if (cached) return cached;
  const pending = loading.get(path);
  if (pending) return pending;

  const ctx = audioContext();
  if (!ctx) return null;
  const request = (async () => {
    try {
      // Cache under the master path so the chosen delivery format stays an
      // implementation detail of this module.
      const delivery = sfxDeliveryPath(path);
      let buffer = await decodeFrom(ctx, delivery).catch(() => null);
      if (!buffer && delivery !== path) {
        buffer = await decodeFrom(ctx, path).catch(() => null);
      }
      if (!buffer) return null;
      buffers.set(path, buffer);
      return buffer;
    } finally {
      // Always clear the in-flight entry: a stuck one would pin this cue to a
      // resolved-null promise for the rest of the session.
      loading.delete(path);
    }
  })();
  loading.set(path, request);
  return request;
}

function output(c: AudioContext): AudioNode {
  return master ?? c.destination;
}

function activeVoices(definition: AudioCueDefinition): Voice[] {
  const voices = voicesByGroup.get(definition.group) ?? [];
  const connected = voices.filter(
    (voice) => voice.startedAt + (voice.source.buffer?.duration ?? 0) > performance.now() / 1_000,
  );
  voicesByGroup.set(definition.group, connected);
  return connected;
}

function stopAllVoices(): void {
  for (const voices of voicesByGroup.values()) {
    for (const voice of voices) {
      try {
        voice.source.stop();
      } catch {
        // Already stopped.
      }
    }
  }
  voicesByGroup.clear();
}

function startSfx(
  cue: GameSfxCue,
  buffer: AudioBuffer,
  gainScale: number,
  playbackRate?: number,
): void {
  const ctx = audioContext();
  if (!ctx || isAudioMuted()) return;
  const definition = SFX_DEFINITIONS[cue];
  const voices = activeVoices(definition);
  if (voices.length >= definition.voiceLimit) return;

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  const jitter = definition.rateJitter
    ? (Math.random() * 2 - 1) * definition.rateJitter
    : 0;
  source.playbackRate.value = Math.max(
    0.85,
    Math.min(1.15, (playbackRate ?? 1) + jitter),
  );
  gain.gain.value = definition.gain * Math.max(0, Math.min(2, gainScale));
  source.connect(gain);
  gain.connect(output(ctx));

  const voice = { source, startedAt: performance.now() / 1_000 };
  voices.push(voice);
  voicesByGroup.set(definition.group, voices);
  source.addEventListener("ended", () => {
    source.disconnect();
    gain.disconnect();
    const groupVoices = voicesByGroup.get(definition.group);
    if (groupVoices) {
      voicesByGroup.set(
        definition.group,
        groupVoices.filter((candidate) => candidate !== voice),
      );
    }
  });
  source.start();
}

const DEFAULT_PRIME_CUES: Array<GameSfxCue | GameAmbienceCue> = [
  "impact-light",
  "command",
  "paper",
];

export function primeGameAudio(
  cues: Array<GameSfxCue | GameAmbienceCue> = DEFAULT_PRIME_CUES,
): void {
  if (isAudioMuted()) return;
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  for (const cue of cues) {
    const path = cue.startsWith("ambience-")
      ? AMBIENCE_PATHS[cue as GameAmbienceCue]
      : SFX_DEFINITIONS[cue as GameSfxCue].path;
    void loadBuffer(path);
  }
  if (ambienceRequest && !ambienceVoice) {
    startGameAmbience(ambienceRequest, ambienceOptions);
  }
}

export function playGameSfx(
  cue: GameSfxCue,
  options: { gain?: number; playbackRate?: number } = {},
): void {
  if (isAudioMuted()) return;
  const definition = SFX_DEFINITIONS[cue];
  const now = performance.now();
  const last = lastPlayedAt.get(cue) ?? Number.NEGATIVE_INFINITY;
  if (now - last < definition.cooldownMs) return;
  lastPlayedAt.set(cue, now);

  const cached = buffers.get(definition.path);
  if (cached) {
    startSfx(cue, cached, options.gain ?? 1, options.playbackRate);
    return;
  }

  const requestedAt = now;
  void loadBuffer(definition.path).then((buffer) => {
    if (!buffer || performance.now() - requestedAt > 180) return;
    startSfx(cue, buffer, options.gain ?? 1, options.playbackRate);
  });
}

function fadeOutAmbience(active: AmbienceVoice, fadeMs: number): void {
  const ctx = context;
  if (!ctx) return;
  const now = ctx.currentTime;
  active.gain.gain.cancelScheduledValues(now);
  active.gain.gain.setValueAtTime(
    Math.max(0.0001, active.gain.gain.value),
    now,
  );
  active.gain.gain.exponentialRampToValueAtTime(
    0.0001,
    now + fadeMs / 1_000,
  );
  window.setTimeout(() => {
    try {
      active.source.stop();
    } catch {
      // Already stopped.
    }
    active.source.disconnect();
    active.gain.disconnect();
  }, fadeMs + 80);
}

function stopAmbienceImmediately(active: AmbienceVoice): void {
  try {
    active.source.stop();
  } catch {
    // Already stopped.
  }
  active.source.disconnect();
  active.gain.disconnect();
}

export function startGameAmbience(
  cue: GameAmbienceCue,
  options: { gain?: number; fadeMs?: number } = {},
): void {
  ambienceRequest = cue;
  ambienceOptions = options;
  if (isAudioMuted()) return;
  const ctx = audioContext();
  if (!ctx) return;
  if (ambienceVoice?.cue === cue) return;
  const gainTarget = Math.max(0.01, Math.min(0.14, options.gain ?? 0.055));
  const fadeMs = Math.max(120, options.fadeMs ?? 900);
  void loadBuffer(AMBIENCE_PATHS[cue]).then((buffer) => {
    if (!buffer || ambienceRequest !== cue || isAudioMuted()) return;
    if (ambienceVoice) fadeOutAmbience(ambienceVoice, fadeMs);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      gainTarget,
      ctx.currentTime + fadeMs / 1_000,
    );
    source.connect(gain);
    gain.connect(output(ctx));
    source.start();
    ambienceVoice = { cue, source, gain };
  });
}

export function stopGameAmbience(fadeMs = 700): void {
  ambienceRequest = null;
  ambienceOptions = {};
  const active = ambienceVoice;
  ambienceVoice = null;
  if (active) fadeOutAmbience(active, Math.max(80, fadeMs));
}

export const gameAudioManifest = {
  sfx: SFX_DEFINITIONS,
  ambience: AMBIENCE_PATHS,
} as const;

// Keep module teardown explicit for hot reload without adding duplicate mute
// listeners. Production bundles never call this path.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeMute?.();
    unsubscribeMute = null;
    stopGameAmbience(80);
    stopAllVoices();
  });
}
