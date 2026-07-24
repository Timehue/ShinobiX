import assert from "node:assert/strict";
import test from "node:test";
import { classifyChronicleLogLine } from "./chronicle-sfx";

test("battle log lines map to the right sound cues", () => {
  assert.equal(
    classifyChronicleLogLine("dopey draws in the Draw Phase."),
    "draw",
  );
  assert.equal(
    classifyChronicleLogLine("Chronicle Keeper Summons Candle Wisp."),
    "summon",
  );
  assert.equal(classifyChronicleLogLine("Chronicle Keeper Sets a Monster."), "summon");
  assert.equal(classifyChronicleLogLine("dopey Sets a Snare Card."), "set");
  assert.equal(
    classifyChronicleLogLine("dopey activates Reconnaissance Scroll."),
    "activate",
  );
  assert.equal(
    classifyChronicleLogLine("Damage Step resolves at 1750 ATK."),
    "attack",
  );
  assert.equal(
    classifyChronicleLogLine(
      "Damage Step: dopey attacks directly for 1750 damage.",
    ),
    "attack",
  );
  // Destruction outranks the attack wording that caused it.
  assert.equal(
    classifyChronicleLogLine("Candle Wisp is destroyed by the attack."),
    "destroy",
  );
  // Phase bookkeeping stays silent.
  assert.equal(classifyChronicleLogLine("dopey enters Main Phase 1."), null);
});
