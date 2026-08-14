import assert from "node:assert/strict";
import test from "node:test";
import { runWarfrontMatch, type WfEvent } from "./pet-warfront-sim.ts";
import type { ArenaRole, ArenaSlot } from "./pet-arena-sim.ts";
import type { Pet } from "../types/pet.ts";
import {
  createWarfrontAudioMixState,
  isCriticalWarfrontAudioEvent,
  scheduledWarfrontAudioPlan,
  seekWarfrontAudio,
  scheduledWarfrontAudioBeats,
  warfrontAudioBeats,
  warfrontMusicBeat,
} from "./warfront-audio.ts";

const event = <T extends WfEvent>(value: T): T => value;

const audioSquad = (prefix: string): ArenaSlot[] => {
  const roles: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
  const elements = ["Earth", "Water", "Fire", "Wind"];
  return roles.map((role, index) => ({
    role,
    pet: {
      id: `${prefix}-${index}`,
      name: `${prefix}${index}`,
      element: elements[index],
      hp: 700,
      attack: 90,
      defense: 45,
      speed: 60,
    } as Pet,
  }));
};

test("routine Warfront hits are sampled while critical hits always speak", () => {
  assert.deepEqual(warfrontAudioBeats(event({ t: 1, type: "hit", targetId: "red-0", actorId: "blue-0", dmg: 12, crit: false })), []);
  assert.equal(warfrontAudioBeats(event({ t: 9, type: "hit", targetId: "red-0", actorId: "blue-0", dmg: 12, crit: false }))[0]?.cue, "impact-light");
  assert.equal(warfrontAudioBeats(event({ t: 2, type: "hit", targetId: "red-0", actorId: "blue-0", dmg: 20, crit: true }))[0]?.cue, "impact-heavy");
});

test("objective steals and seal victories receive distinct top-priority cues", () => {
  const steal = warfrontAudioBeats(event({ t: 100, type: "minikill", padIdx: 1, team: "blue", reward: "stoneguard", awakened: true, stolen: true }));
  const claim = warfrontAudioBeats(event({ t: 100, type: "minikill", padIdx: 1, team: "blue", reward: "stoneguard", awakened: true, stolen: false }));
  const victory = warfrontAudioBeats(event({ t: 200, type: "coredown", team: "red", by: "blue" }));
  assert.deepEqual(steal.map((beat) => beat.cue), ["warfront-objective-steal"]);
  assert.deepEqual(claim.map((beat) => beat.cue), ["chapter-seal"]);
  assert.deepEqual(victory.map((beat) => beat.cue), ["victory-seal", "crowd"]);
  const verdict = warfrontAudioBeats(event({ t: 18_000, type: "verdict", winner: "red", blueScore: 2, redScore: 3, blueCoins: 900, redCoins: 940 }));
  assert.deepEqual(verdict.map((beat) => beat.cue), ["victory-seal", "crowd"]);
});

test("Suno objective cues mark Sigil and Gate Warden awakenings", () => {
  const sigil = warfrontAudioBeats(event({ t: 3_150, type: "sigilawake", padIdx: 0, x: 0, y: 0 }));
  const war = warfrontAudioBeats(event({ t: 7_200, type: "phase", name: "WAR" }));
  assert.deepEqual(sigil.map((beat) => beat.cue), ["warfront-sigil-awakening"]);
  assert.deepEqual(war.map((beat) => beat.cue), ["warfront-warden-awakening"]);
  assert.ok((warfrontMusicBeat(event({ t: 3_150, type: "sigilawake", padIdx: 0, x: 0, y: 0 })).duck?.holdMs ?? 0) >= 3_000);
  assert.ok((warfrontMusicBeat(event({ t: 7_200, type: "phase", name: "WAR" })).duck?.holdMs ?? 0) >= 4_000);
});

test("spam-heavy ambient simulation events stay silent", () => {
  assert.deepEqual(warfrontAudioBeats(event({ t: 3, type: "mobhit", x: 1, y: 2, targetId: "blue-0" })), []);
  assert.deepEqual(warfrontAudioBeats(event({ t: 3, type: "mobwave" })), []);
});

test("authored tactics reuse distinct existing broadcast cues without proc spam", () => {
  assert.equal(warfrontAudioBeats(event({ t: 0, type: "deployment", team: "blue", slots: ["top", "mid", "bottom", "flex"], lockSecs: 40 }))[0]?.cue, "command");
  assert.equal(warfrontAudioBeats(event({ t: 2_700, type: "coachorder", team: "blue", round: 1, order: "contest" }))[0]?.cue, "command");
  assert.equal(warfrontAudioBeats(event({ t: 2_700, type: "buildpackage", team: "blue", round: 1, choice: "hold-line" }))[0]?.cue, "decision");
  assert.equal(warfrontAudioBeats(event({ t: 3_150, type: "techniqueused", team: "blue", choice: "hijack", padIdx: 1, actorId: "blue-1" }))[0]?.cue, "warfront-objective-steal");
  assert.equal(warfrontAudioBeats(event({ t: 4_200, type: "counterstrike", team: "blue", choice: "fortify", statue: 0, secs: 45 }))[0]?.cue, "guard");
  assert.deepEqual(warfrontAudioBeats(event({ t: 4_500, type: "counterstrikeclaim", team: "blue", targetId: "red-1", actorId: "blue-1", bounty: 150 })).map((beat) => beat.cue), ["knockout", "crowd"]);

  const mix = createWarfrontAudioMixState();
  const proc = event({ t: 900, type: "packageproc", team: "blue", choice: "blood-hunt", actorId: "blue-1", targetId: "red-1" } as const);
  assert.equal(scheduledWarfrontAudioBeats(proc, mix)[0]?.cue, "chakra-negative");
  assert.deepEqual(scheduledWarfrontAudioBeats({ ...proc, t: 1_020 }, mix), []);
  assert.equal(scheduledWarfrontAudioBeats({ ...proc, t: 1_261 }, mix)[0]?.cue, "chakra-negative");
});

test("the score escalates with match phases and ducks under decisive objectives", () => {
  assert.equal(warfrontMusicBeat(event({ t: 1_800, type: "phase", name: "SKIRMISH" })).intensity, "pressure");
  assert.equal(warfrontMusicBeat(event({ t: 12_600, type: "phase", name: "SUDDEN DEATH" })).intensity, "climax");
  assert.equal(warfrontMusicBeat(event({ t: 7_200, type: "wardenphase", phase: 3, x: 0, y: 0 })).intensity, "climax");
  assert.ok((warfrontMusicBeat(event({ t: 9_000, type: "coredown", team: "red", by: "blue" })).duck?.holdMs ?? 0) >= 1_500);
});

test("tactical, boss, elemental, and mercy events have distinct broadcast voices", () => {
  const gank = warfrontAudioBeats(event({ t: 900, type: "gank", actorId: "blue-2", targetId: "red-0", x: 1, y: 2 }));
  const shell = warfrontAudioBeats(event({ t: 950, type: "bosssig", padIdx: 1, kind: "shell", x: 2, y: 3 }));
  const mercy = warfrontAudioBeats(event({ t: 9_000, type: "mercy", team: "blue" }));
  assert.deepEqual(gank.map((beat) => beat.cue), ["command"]);
  assert.deepEqual(shell.map((beat) => beat.cue), ["guard"]);
  assert.deepEqual(mercy.map((beat) => beat.cue), ["omen"]);

  const signatures = Array.from({ length: 12 }, (_, index) => warfrontAudioBeats(event({
    t: 1_000 + index,
    type: "elemsig",
    petId: `blue-${index % 4}`,
    el: index % 2 ? "Fire" : "Water",
    name: "SIGNATURE",
    px: 0,
    py: 0,
    x: 1,
    y: 1,
    targetId: "red-0",
  })).map((beat) => beat.cue));
  const audible = signatures.filter((beats) => beats.length > 0).length;
  assert.ok(audible > 0 && audible < signatures.length, "elemental signatures should be deterministically sampled");
  assert.deepEqual(signatures, Array.from({ length: 12 }, (_, index) => warfrontAudioBeats(event({
    t: 1_000 + index,
    type: "elemsig",
    petId: `blue-${index % 4}`,
    el: index % 2 ? "Fire" : "Water",
    name: "SIGNATURE",
    px: 0,
    py: 0,
    x: 1,
    y: 1,
    targetId: "red-0",
  })).map((beat) => beat.cue)));
});

test("family cooldowns suppress repetition while higher-salience moments break through", () => {
  const mix = createWarfrontAudioMixState();
  const kill = event({ t: 300, type: "kill", targetId: "red-0", actorId: "blue-0", team: "blue" } as const);
  const shutdown = event({ t: 305, type: "shutdown", targetId: "red-1", actorId: "blue-1", bounty: 80, streak: 4 } as const);
  assert.deepEqual(scheduledWarfrontAudioBeats(kill, mix).map((beat) => beat.cue), ["knockout"]);
  assert.deepEqual(scheduledWarfrontAudioBeats({ ...kill, t: 304 }, mix), []);
  assert.deepEqual(scheduledWarfrontAudioBeats(shutdown, mix).map((beat) => beat.cue), ["battle-transition", "crowd"]);
  assert.deepEqual(scheduledWarfrontAudioBeats({ ...kill, t: 306 }, mix), []);
  assert.deepEqual(scheduledWarfrontAudioBeats({ ...kill, t: 324 }, mix).map((beat) => beat.cue), ["knockout"]);
});

test("terminal victory audio bypasses a recent broadcast-family cue", () => {
  const mix = createWarfrontAudioMixState();
  const shutdown = event({ t: 100, type: "shutdown", targetId: "red-1", actorId: "blue-1", bounty: 80, streak: 4 } as const);
  const victory = event({ t: 110, type: "coredown", team: "red", by: "blue" } as const);
  assert.deepEqual(scheduledWarfrontAudioBeats(shutdown, mix).map((beat) => beat.cue), ["battle-transition", "crowd"]);
  assert.deepEqual(scheduledWarfrontAudioBeats(victory, mix).map((beat) => beat.cue), ["victory-seal", "crowd"]);
});

test("adjacent shutdowns cannot swallow Warden phases, WAR, or a seal break", () => {
  const mix = createWarfrontAudioMixState();
  const shutdown = event({ t: 100, type: "shutdown", targetId: "red-1", actorId: "blue-1", bounty: 80, streak: 4 } as const);
  const phaseTwo = event({ t: 101, type: "wardenphase", phase: 2, x: 0, y: 0 } as const);
  const war = event({ t: 102, type: "phase", name: "WAR" } as const);
  const victory = event({ t: 103, type: "coredown", team: "red", by: "blue" } as const);
  assert.deepEqual(scheduledWarfrontAudioBeats(shutdown, mix).map((beat) => beat.cue), ["battle-transition", "crowd"]);
  assert.deepEqual(scheduledWarfrontAudioBeats(phaseTwo, mix).map((beat) => beat.cue), ["battle-transition"]);
  assert.deepEqual(scheduledWarfrontAudioBeats(war, mix).map((beat) => beat.cue), ["warfront-warden-awakening"]);
  assert.deepEqual(scheduledWarfrontAudioBeats(victory, mix).map((beat) => beat.cue), ["victory-seal", "crowd"]);
});

test("music ducking survives SFX-family suppression", () => {
  const mix = createWarfrontAudioMixState();
  scheduledWarfrontAudioBeats(event({ t: 100, type: "shutdown", targetId: "red-1", actorId: "blue-1", bounty: 80, streak: 4 } as const), mix);
  const plan = scheduledWarfrontAudioPlan(event({ t: 101, type: "statuedown", team: "red", statue: 0, by: "blue" } as const), mix);
  assert.deepEqual(plan.beats, [], "the lower-priority impact may be mixed out");
  assert.ok((plan.music.duck?.holdMs ?? 0) > 0, "the independent music bus must still duck");
});

test("20 deterministic event streams never drop a critical scheduled cue", () => {
  let criticalCount = 0;
  let wardenPhaseCount = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const result = runWarfrontMatch(audioSquad("A"), audioSquad("B"), seed, "balanced", "balanced", undefined, undefined, undefined, { captureSnapshots: false });
    const mix = createWarfrontAudioMixState();
    for (const item of result.events) {
      const source = warfrontAudioBeats(item);
      const scheduled = scheduledWarfrontAudioBeats(item, mix);
      if (!isCriticalWarfrontAudioEvent(item) || source.length === 0) continue;
      criticalCount++;
      if (item.type === "wardenphase") wardenPhaseCount++;
      assert.ok(scheduled.length > 0, `critical ${item.type} cue was dropped at seed ${seed}, tick ${item.t}`);
    }
  }
  assert.ok(criticalCount > 20, "the regression must exercise a broad critical-event sample");
  assert.ok(wardenPhaseCount >= 5, "the regression must cover the previously dropped Warden phase transitions");
});

test("Council purchases resolve into one lock-in cue and one earned payoff motif", () => {
  const mix = createWarfrontAudioMixState();
  const firstBuy = event({ t: 2_700, type: "buy", team: "blue", petId: "blue-0", kind: "strike", cost: 50 } as const);
  const secondBuy = event({ t: 2_700, type: "buy", team: "blue", petId: "blue-1", kind: "guard", cost: 50 } as const);
  assert.deepEqual(scheduledWarfrontAudioBeats(firstBuy, mix).map((beat) => beat.cue), ["decision"]);
  assert.deepEqual(scheduledWarfrontAudioBeats(secondBuy, mix), []);

  const payoff = event({ t: 2_760, type: "kill", targetId: "red-0", actorId: "blue-1", team: "blue" } as const);
  assert.deepEqual(scheduledWarfrontAudioBeats(payoff, mix).map((beat) => beat.cue), ["knockout", "reveal"]);
  assert.deepEqual(scheduledWarfrontAudioBeats({ ...payoff, t: 2_790 }, mix).map((beat) => beat.cue), ["knockout"]);
});

test("a mix-gated Council payoff is consumed instead of credited to a later kill", () => {
  const mix = createWarfrontAudioMixState();
  scheduledWarfrontAudioBeats(event({ t: 100, type: "shutdown", targetId: "red-1", actorId: "blue-1", bounty: 80, streak: 4 } as const), mix);
  scheduledWarfrontAudioBeats(event({ t: 110, type: "buy", team: "blue", petId: "blue-0", kind: "strike", cost: 50 } as const), mix);
  assert.deepEqual(scheduledWarfrontAudioBeats(event({ t: 111, type: "kill", targetId: "red-0", actorId: "blue-0", team: "blue" } as const), mix), []);
  assert.deepEqual(scheduledWarfrontAudioBeats(event({ t: 146, type: "kill", targetId: "red-2", actorId: "blue-0", team: "blue" } as const), mix).map((beat) => beat.cue), ["knockout"]);
});

test("replay seek silently restores score intensity and consumed Council payoffs", () => {
  const events = [
    event({ t: 1_800, type: "phase", name: "SKIRMISH" } as const),
    event({ t: 2_700, type: "buy", team: "blue", petId: "blue-0", kind: "strike", cost: 50 } as const),
    event({ t: 2_760, type: "kill", targetId: "red-0", actorId: "blue-0", team: "blue" } as const),
    event({ t: 2_800, type: "buy", team: "blue", petId: "blue-1", kind: "guard", cost: 50 } as const),
    event({ t: 12_600, type: "phase", name: "SUDDEN DEATH" } as const),
  ] satisfies WfEvent[];

  const [pressure, pressureMix] = seekWarfrontAudio(events, 3_000);
  assert.equal(pressure, "pressure");
  assert.equal(pressureMix.b.has("blue-0"), false, "an already-paid purchase must stay consumed");
  assert.equal(pressureMix.b.has("blue-1"), true, "an unpaid purchase remains armed");

  const [climax] = seekWarfrontAudio(events, 12_600);
  assert.equal(climax, "climax");
});
