import {
  isAudioMuted,
  subscribeAudioMute,
} from "./pet-music";

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
  | "battle-transition"
  | "warfront-sigil-awakening"
  | "warfront-warden-awakening"
  | "warfront-objective-steal";

export type GameAmbienceCue =
  | "ambience-shrine"
  | "ambience-village"
  | "ambience-road"
  | "ambience-interior"
  | "ambience-hollow";

type AudioCueDefinition = {
  path: string;
  gain: number;
  group: "impact" | "movement" | "status" | "terminal" | "crowd" | "ritual" | "story" | "warfront-objective" | "warfront-steal";
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
    // This supporting layer must not evict the decisive seal or knockout that
    // is authored in the same event. It remains bounded in its own group.
    group: "crowd",
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
  "warfront-sigil-awakening": {
    path: "/sfx/production/warfront-sigil-awakening-suno.mp3",
    gain: 0.2,
    group: "warfront-objective",
    cooldownMs: 1_500,
    voiceLimit: 1,
  },
  "warfront-warden-awakening": {
    path: "/sfx/production/warfront-warden-awakening-suno.mp3",
    gain: 0.2,
    group: "warfront-objective",
    cooldownMs: 5_000,
    voiceLimit: 1,
  },
  "warfront-objective-steal": {
    path: "/sfx/production/warfront-objective-steal-suno.mp3",
    gain: 0.22,
    group: "warfront-steal",
    cooldownMs: 2_000,
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
  priority: "normal" | "critical";
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

export function gameAudioCooldownAllows(
  now: number,
  lastPlayed: number,
  cooldownMs: number,
  priority: "normal" | "critical" = "normal",
): boolean {
  return priority === "critical" || now - lastPlayed >= cooldownMs;
}

export function gameAudioVoiceAdmission(
  activePriorities: readonly ("normal" | "critical")[],
  voiceLimit: number,
  priority: "normal" | "critical" = "normal",
): { allowed: boolean; replaceIndex: number | null } {
  if (activePriorities.length < voiceLimit) return { allowed: true, replaceIndex: null };
  if (priority !== "critical" || voiceLimit <= 0 || activePriorities.length === 0) return { allowed: false, replaceIndex: null };
  const routineIndex = activePriorities.indexOf("normal");
  return { allowed: true, replaceIndex: routineIndex >= 0 ? routineIndex : 0 };
}

/** Pure policy seam for proving that simultaneous authored layers occupy
 * independent bounded voice slots. */
export function gameAudioVoiceGroup(cue: GameSfxCue): AudioCueDefinition["group"] {
  return SFX_DEFINITIONS[cue].group;
}

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

async function loadBuffer(path: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(path);
  if (cached) return cached;
  const pending = loading.get(path);
  if (pending) return pending;

  const ctx = audioContext();
  if (!ctx) return null;
  const request = (async () => {
    try {
      const response = await fetch(path);
      if (!response.ok) return null;
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      buffers.set(path, buffer);
      return buffer;
    } catch {
      return null;
    } finally {
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
  priority: "normal" | "critical" = "normal",
): void {
  const ctx = audioContext();
  if (!ctx || isAudioMuted()) return;
  const definition = SFX_DEFINITIONS[cue];
  const voices = activeVoices(definition);
  const admission = gameAudioVoiceAdmission(voices.map((voice) => voice.priority), definition.voiceLimit, priority);
  if (!admission.allowed) return;
  if (admission.replaceIndex !== null) {
    // A decisive broadcast cue owns the bounded group slot. Prefer replacing
    // a routine voice; if the whole group is already critical, replace its
    // oldest member so concurrency never exceeds the authored voice limit.
    const replacement = voices[admission.replaceIndex];
    if (replacement) {
      try { replacement.source.stop(); } catch { /* source already ended */ }
      voicesByGroup.set(definition.group, voices.filter((voice) => voice !== replacement));
    }
  }

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

  const voice = { source, startedAt: performance.now() / 1_000, priority };
  const currentVoices = voicesByGroup.get(definition.group) ?? voices;
  currentVoices.push(voice);
  voicesByGroup.set(definition.group, currentVoices);
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
  options: { gain?: number; playbackRate?: number; priority?: "normal" | "critical" } = {},
): void {
  if (isAudioMuted()) return;
  const priority = options.priority ?? "normal";
  const definition = SFX_DEFINITIONS[cue];
  const now = performance.now();
  const last = lastPlayedAt.get(cue) ?? Number.NEGATIVE_INFINITY;
  if (!gameAudioCooldownAllows(now, last, definition.cooldownMs, priority)) return;
  lastPlayedAt.set(cue, now);

  const cached = buffers.get(definition.path);
  if (cached) {
    startSfx(cue, cached, options.gain ?? 1, options.playbackRate, priority);
    return;
  }

  const requestedAt = now;
  void loadBuffer(definition.path).then((buffer) => {
    if (!buffer || (priority !== "critical" && performance.now() - requestedAt > 180)) return;
    startSfx(cue, buffer, options.gain ?? 1, options.playbackRate, priority);
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
