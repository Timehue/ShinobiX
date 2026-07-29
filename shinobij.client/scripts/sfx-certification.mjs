import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const productionDir = path.join(root, "public", "sfx", "production");
const enginePath = path.join(root, "src", "lib", "game-audio.ts");
const battleMusicPath = path.join(root, "src", "lib", "pet-music.ts");
const vnScorePath = path.join(root, "src", "lib", "vn-cinematic-score.ts");

const oneShotMax = {
  "impact-light": 0.51,
  "impact-heavy": 0.81,
  guard: 0.81,
  evade: 0.61,
  "chakra-positive": 1.41,
  "chakra-negative": 1.51,
  knockout: 1.41,
  "victory-seal": 2.01,
  command: 0.36,
  crowd: 2.41,
  paper: 0.91,
  "foil-tear": 0.91,
  "card-place": 1.11,
  "pack-pop": 0.56,
  reveal: 1.41,
  mythic: 1.81,
  "chapter-seal": 1.21,
  omen: 1.31,
  decision: 0.86,
  "battle-transition": 1.61,
};

const ambience = [
  "ambience-shrine",
  "ambience-village",
  "ambience-road",
  "ambience-interior",
  "ambience-hollow",
];

const legacyFiles = [
  "absorb.ogg",
  "buff.ogg",
  "crit.ogg",
  "debuff.ogg",
  "dodge.mp3",
  "dot.ogg",
  "heal.ogg",
  "hit_1.ogg",
  "hit_2.ogg",
  "hit_3.ogg",
  "hit_4.ogg",
  "ko.mp3",
  "shield.mp3",
  "victory.ogg",
];

function parseWav(buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not RIFF/WAVE");
  }
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw new Error("missing fmt/data chunk");
  let peak = 0;
  let clipped = 0;
  for (let index = 0; index + 1 < data.length; index += 2) {
    const value = Math.abs(data.readInt16LE(index));
    peak = Math.max(peak, value);
    if (value >= 32767) clipped += 1;
  }
  let edgePeak = 0;
  let seamJump = 0;
  for (let channel = 0; channel < format.channels; channel += 1) {
    const first = data.readInt16LE(channel * 2) / 32768;
    const lastOffset = data.length - format.blockAlign + channel * 2;
    const last = data.readInt16LE(lastOffset) / 32768;
    edgePeak = Math.max(edgePeak, Math.abs(first), Math.abs(last));
    seamJump = Math.max(seamJump, Math.abs(first - last));
  }
  return {
    ...format,
    duration: data.length / format.blockAlign / format.sampleRate,
    peak: peak / 32768,
    clipped,
    edgePeak,
    seamJump,
  };
}

const failures = [];
const rows = [];
const engine = await fs.readFile(enginePath, "utf8");

for (const [cue, maxDuration] of Object.entries(oneShotMax)) {
  const fileName = `${cue}.wav`;
  const filePath = path.join(productionDir, fileName);
  try {
    const parsed = parseWav(await fs.readFile(filePath));
    rows.push({ cue, kind: "one-shot", ...parsed });
    if (parsed.duration > maxDuration) {
      failures.push(`${cue}: ${parsed.duration.toFixed(3)}s exceeds ${maxDuration}s`);
    }
    if (parsed.channels > 2) failures.push(`${cue}: more than two channels`);
    if (parsed.edgePeak > 0.01) {
      failures.push(`${cue}: fade edge is too hot (${parsed.edgePeak.toFixed(4)})`);
    }
    if (!engine.includes(`/sfx/production/${fileName}`)) {
      failures.push(`${cue}: not referenced by game-audio.ts`);
    }
  } catch (error) {
    failures.push(`${cue}: ${error instanceof Error ? error.message : error}`);
  }
}

for (const cue of ambience) {
  const fileName = `${cue}.wav`;
  const filePath = path.join(productionDir, fileName);
  try {
    const parsed = parseWav(await fs.readFile(filePath));
    rows.push({ cue, kind: "loop", ...parsed });
    if (parsed.duration < 6 || parsed.duration > 14) {
      failures.push(`${cue}: loop duration must be 6–14 seconds`);
    }
    if (parsed.channels !== 2) failures.push(`${cue}: ambience must be stereo`);
    if (parsed.seamJump > 0.05) {
      failures.push(`${cue}: loop seam jump ${parsed.seamJump.toFixed(4)} is too large`);
    }
    if (!engine.includes(`/sfx/production/${fileName}`)) {
      failures.push(`${cue}: not referenced by game-audio.ts`);
    }
  } catch (error) {
    failures.push(`${cue}: ${error instanceof Error ? error.message : error}`);
  }
}

for (const row of rows) {
  if (row.audioFormat !== 1 || row.bitsPerSample !== 16) {
    failures.push(`${row.cue}: expected 16-bit PCM`);
  }
  if (row.sampleRate !== 48_000) {
    failures.push(`${row.cue}: expected 48 kHz, got ${row.sampleRate}`);
  }
  if (row.peak < 0.68 || row.peak > 0.72) {
    failures.push(`${row.cue}: unexpected master peak ${row.peak.toFixed(3)}`);
  }
  if (row.clipped > 0) failures.push(`${row.cue}: contains clipped samples`);
}

for (const file of legacyFiles) {
  try {
    await fs.access(path.join(root, "public", "sfx", file));
    failures.push(`legacy asset still present: public/sfx/${file}`);
  } catch {
    // Expected.
  }
}

const proceduralFiles = [
  "src/lib/pet-sfx.ts",
  "src/lib/chronicle-sfx.ts",
  "src/lib/story-sfx.ts",
  "src/lib/vn-cinematic-sfx.ts",
  "src/lib/pet-music.ts",
  "src/features/intro-cinematic/introCinematicSfx.ts",
];
for (const relative of proceduralFiles) {
  const source = await fs.readFile(path.join(root, relative), "utf8");
  if (/createOscillator|createBuffer\(|noiseBurst|filteredNoise|resonantTone/.test(source)) {
    failures.push(`${relative}: procedural audio generator reintroduced`);
  }
}

// The visible speaker control is a true master switch, not merely an SFX
// preference. Keep hard-stop guards on all three playback owners so a pending
// play() promise or an ambience crossfade cannot leak audio after mute.
const battleMusic = await fs.readFile(battleMusicPath, "utf8");
const vnScore = await fs.readFile(vnScorePath, "utf8");
if (!/audioEl\.muted = muted/.test(battleMusic) || !/if \(muted\) audioEl\.pause\(\)/.test(battleMusic)) {
  failures.push("pet-music.ts: battle music is not hard-muted and paused by the master switch");
}
if (!/currentTheme !== null && audioEl\.src/.test(battleMusic)) {
  failures.push("pet-music.ts: unmute can revive a stopped/stale battle track");
}
if (!/deck\.muted = muted/.test(vnScore) || !/decks\.forEach\(\(deck\) => deck\.pause\(\)\)/.test(vnScore)) {
  failures.push("vn-cinematic-score.ts: story score is not hard-muted and paused");
}
if (
  !/master\.gain\.setValueAtTime\(0, context\.currentTime\)/.test(engine)
  || !/stopAllVoices\(\)/.test(engine)
  || !/stopAmbienceImmediately\(active\)/.test(engine)
) {
  failures.push("game-audio.ts: SFX/ambience bus is not silenced immediately by master mute");
}

console.table(
  rows.map((row) => ({
    cue: row.cue,
    kind: row.kind,
    channels: row.channels,
    seconds: row.duration.toFixed(2),
    peak: row.peak.toFixed(3),
  })),
);

if (failures.length) {
  console.error(`\nSFX certification failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nSFX certification passed: ${rows.length} mastered cues.`);
