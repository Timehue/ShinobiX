/** Asset-free WebAudio cues for the Chronicle Showdown board.
 *
 * Everything is synthesized (short tones + filtered noise), so there are no
 * audio files to load and nothing counts against the bundle budget. The
 * AudioContext is created lazily on the first play attempt — every play call
 * happens after a user gesture (card clicks, action buttons), which satisfies
 * browser autoplay policies. All failures are swallowed: sound is garnish,
 * never a crash source.
 */

export type ChronicleSfx =
  | "draw"
  | "summon"
  | "set"
  | "activate"
  | "attack"
  | "destroy"
  | "victory"
  | "defeat";

const MUTE_KEY = "chronicleSfx.v1";

let context: AudioContext | null = null;
let muted: boolean | null = null;

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
    /* private mode — session-only preference */
  }
}

function ensureContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** One enveloped oscillator sweep. */
function tone(
  ctx: AudioContext,
  type: OscillatorType,
  fromHz: number,
  toHz: number,
  start: number,
  duration: number,
  peak: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const at = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), at + duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** One enveloped low-passed noise burst (impacts, shatters). */
function noiseBurst(
  ctx: AudioContext,
  start: number,
  duration: number,
  peak: number,
  filterHz: number,
): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++)
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const at = ctx.currentTime + start;
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = filterHz;
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
}

export function playChronicleSfx(kind: ChronicleSfx): void {
  if (readMuted()) return;
  const ctx = ensureContext();
  if (!ctx) return;
  try {
    switch (kind) {
      case "draw":
        tone(ctx, "sine", 840, 1240, 0, 0.07, 0.06);
        break;
      case "summon":
        tone(ctx, "sine", 170, 70, 0, 0.2, 0.16);
        tone(ctx, "triangle", 520, 660, 0.02, 0.09, 0.05);
        break;
      case "set":
        tone(ctx, "triangle", 330, 240, 0, 0.09, 0.07);
        break;
      case "activate":
        tone(ctx, "square", 620, 990, 0, 0.11, 0.045);
        tone(ctx, "sine", 990, 1320, 0.07, 0.09, 0.04);
        break;
      case "attack":
        noiseBurst(ctx, 0, 0.12, 0.14, 1800);
        tone(ctx, "sine", 210, 60, 0, 0.16, 0.15);
        break;
      case "destroy":
        noiseBurst(ctx, 0, 0.26, 0.16, 2600);
        tone(ctx, "sine", 130, 40, 0.02, 0.3, 0.16);
        break;
      case "victory":
        tone(ctx, "triangle", 523, 523, 0, 0.11, 0.08);
        tone(ctx, "triangle", 659, 659, 0.11, 0.11, 0.08);
        tone(ctx, "triangle", 784, 1046, 0.22, 0.26, 0.09);
        break;
      case "defeat":
        tone(ctx, "triangle", 392, 370, 0, 0.18, 0.08);
        tone(ctx, "triangle", 311, 233, 0.18, 0.3, 0.08);
        break;
    }
  } catch {
    /* audio is best-effort */
  }
}

/** Map a battle-log line to a cue. Order matters: a destruction line often
 *  also names the attack that caused it. Returns null for bookkeeping lines. */
export function classifyChronicleLogLine(line: string): ChronicleSfx | null {
  if (/destroy/i.test(line)) return "destroy";
  if (/damage step|attacks directly/i.test(line)) return "attack";
  if (/summons|sets a monster/i.test(line)) return "summon";
  if (/sets a snare/i.test(line)) return "set";
  if (/activates|may respond/i.test(line)) return "activate";
  if (/draws? /i.test(line)) return "draw";
  return null;
}
