import assert from "node:assert/strict";
import test from "node:test";
import {
  gameAudioCooldownAllows,
  gameAudioVoiceAdmission,
  gameAudioVoiceGroup,
} from "./game-audio.ts";

test("routine audio keeps its existing cooldown behavior", () => {
  assert.equal(gameAudioCooldownAllows(1_100, 1_000, 180), false);
  assert.equal(gameAudioCooldownAllows(1_180, 1_000, 180), true);
  assert.equal(gameAudioCooldownAllows(1_100, 1_000, 180, "normal"), false);
});

test("critical audio bypasses cooldown without changing the default", () => {
  assert.equal(gameAudioCooldownAllows(1_001, 1_000, 5_000, "critical"), true);
  assert.equal(gameAudioCooldownAllows(1_001, 1_000, 5_000), false);
});

test("routine voices remain bounded and never evict another caller", () => {
  assert.deepEqual(gameAudioVoiceAdmission([], 1), { allowed: true, replaceIndex: null });
  assert.deepEqual(gameAudioVoiceAdmission(["normal"], 1), { allowed: false, replaceIndex: null });
  assert.deepEqual(gameAudioVoiceAdmission(["critical"], 1, "normal"), { allowed: false, replaceIndex: null });
  assert.deepEqual(gameAudioVoiceAdmission([], 0), { allowed: false, replaceIndex: null });
});

test("critical voices replace a routine voice first and never grow the group", () => {
  const priorities = ["critical", "normal"] as const;
  const admission = gameAudioVoiceAdmission(priorities, 2, "critical");
  assert.deepEqual(admission, { allowed: true, replaceIndex: 1 });

  const afterReplacement = [...priorities];
  if (admission.replaceIndex !== null) afterReplacement.splice(admission.replaceIndex, 1);
  afterReplacement.push("critical");
  assert.deepEqual(afterReplacement, ["critical", "critical"]);
  assert.equal(afterReplacement.length, 2);
});

test("an all-critical full group replaces its oldest voice", () => {
  assert.deepEqual(gameAudioVoiceAdmission(["critical", "critical"], 2, "critical"), {
    allowed: true,
    replaceIndex: 0,
  });
});

test("supporting crowd never evicts a same-event decisive cue", () => {
  assert.equal(gameAudioVoiceGroup("victory-seal"), "terminal");
  assert.equal(gameAudioVoiceGroup("knockout"), "terminal");
  assert.equal(gameAudioVoiceGroup("crowd"), "crowd");
  assert.notEqual(gameAudioVoiceGroup("crowd"), gameAudioVoiceGroup("victory-seal"));
  assert.notEqual(gameAudioVoiceGroup("crowd"), gameAudioVoiceGroup("knockout"));
});
